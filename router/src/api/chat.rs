use super::handlers::{json_error, validate_chat_request, RequestId};
use crate::{
    cache::cache_key,
    error::error_response,
    models::{
        CacheStatus, CachedResponse, ChatRequest, DoneEvent, MetaEvent, Mode, StreamErrorEvent,
        TokenEvent, Usage,
    },
    ollama::{OllamaChunk, OllamaError},
    policy::{PolicyEngine, Selector},
    queue::QueueError,
    state::AppState,
};
use axum::{
    extract::{rejection::JsonRejection, Extension, Json, State},
    http::{header, HeaderName, HeaderValue},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
};
use chrono::Utc;
use futures_util::{Stream, StreamExt};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    convert::Infallible,
    sync::Arc,
    time::{Duration, Instant},
};
use uuid::Uuid;

/// POST `/v1/route/chat`: cache lookup, policy, inference and unbuffered SSE.
pub async fn chat(
    State(state): State<Arc<AppState>>,
    Extension(request_id): Extension<RequestId>,
    body: Result<Json<ChatRequest>, JsonRejection>,
) -> Response {
    let mut request = match body {
        Ok(Json(request)) => request,
        Err(rejection) => return json_error(rejection, request_id.0),
    };
    request.request_id = Some(request_id.0);
    if let Err(error) = validate_chat_request(&request) {
        return error_response(error, request_id.0);
    }

    let latest_user = request
        .messages
        .iter()
        .rev()
        .find(|message| matches!(message.role, crate::models::Role::User))
        .map(|message| message.content.as_str())
        .unwrap_or_default();
    let prompt_hash = hex::encode(Sha256::digest(latest_user.as_bytes()));
    tracing::info!(request_id = %request_id.0, prompt_hash = %prompt_hash.chars().take(8).collect::<String>(), prompt_len = latest_user.len(), "chat request received");

    let cache_allowed = request.use_cache
        && request.mode != Mode::Force
        && request.options.temperature <= state.config.cache_max_temperature;
    let key = cache_key(&request.messages, &request.options);
    let mut cache_status = if cache_allowed {
        CacheStatus::Miss
    } else {
        CacheStatus::Bypass
    };
    let cached = if cache_allowed {
        match state.cache.get(&key).await {
            Ok(Some(response)) => {
                cache_status = CacheStatus::Hit;
                Some(response)
            }
            Ok(None) => None,
            Err(error) => {
                cache_status = CacheStatus::Bypass;
                state.metrics.cache_errors.inc();
                tracing::warn!(request_id = %request_id.0, %error, "cache lookup failed; bypassing");
                None
            }
        }
    } else {
        None
    };
    state.record_cache(&cache_status);

    if let Some(cached) = cached {
        return cache_replay(state, request_id.0, cache_status, cached);
    }

    let classification = state.classifier.classify(&request);
    let decision = match PolicyEngine::new(&state.config, &state.queue).select(
        &request,
        &classification,
        state.loaded_model().as_deref(),
    ) {
        Ok(decision) => decision,
        Err(error) => return error_response(error, request_id.0),
    };
    let cacheable = cache_allowed && cache_status == CacheStatus::Miss;
    let cache_key = key;
    let prompt_tokens = classification.estimated_tokens;
    let request_options = request.options.clone();
    let request_messages = request.messages.clone();
    let initial_meta = MetaEvent {
        request_id: request_id.0,
        model: decision.model.clone(),
        tier: decision.tier.clone(),
        score: decision.score,
        intent: decision.intent.clone(),
        reason: decision.reason.clone(),
        cache: cache_status.clone(),
        swap_expected: decision.swap_expected,
        fallback_from: None,
    };
    let stream = live_stream(
        state,
        LiveStreamInput {
            request_id: request_id.0,
            decision,
            initial_meta,
            messages: request_messages,
            options: request_options,
            estimated_prompt_tokens: prompt_tokens,
            cache_key,
            cacheable,
            cache_status,
        },
    );
    sse_response(request_id.0, stream)
}

fn cache_replay(
    state: Arc<AppState>,
    request_id: Uuid,
    cache_status: CacheStatus,
    cached: CachedResponse,
) -> Response {
    let stream = async_stream::stream! {
        let mut terminal = TerminalGuard::new(Arc::clone(&state));
        let started = Instant::now();
        let meta = MetaEvent { request_id, model: cached.decision.model.clone(), tier: cached.decision.tier.clone(), score: cached.decision.score, intent: cached.decision.intent.clone(), reason: cached.decision.reason.clone(), cache: cache_status.clone(), swap_expected: false, fallback_from: None };
        yield Ok(json_event("meta", &meta));
        for chunk in cache_replay_chunks(&cached.text) {
            let token = TokenEvent { text: chunk };
            yield Ok(json_event("token", &token));
        }
        let elapsed = started.elapsed().as_secs_f64() * 1000.0;
        let mut usage = cached.usage.clone();
        usage.ttft_ms = elapsed;
        usage.total_ms = elapsed;
        state.metrics.ttft.observe(elapsed / 1000.0);
        state.set_loaded_model(&cached.decision.model);
        state.record_decision(&cached.decision, cache_status, elapsed).await;
        yield Ok(json_event("done", &DoneEvent { request_id, usage }));
        terminal.complete();
    };
    sse_response(request_id, stream)
}

struct LiveStreamInput {
    request_id: Uuid,
    decision: crate::models::RouteDecision,
    initial_meta: MetaEvent,
    messages: Vec<crate::models::Message>,
    options: crate::models::ChatOptions,
    estimated_prompt_tokens: u32,
    cache_key: String,
    cacheable: bool,
    cache_status: CacheStatus,
}

fn live_stream(
    state: Arc<AppState>,
    input: LiveStreamInput,
) -> impl Stream<Item = Result<Event, Infallible>> + Send + 'static {
    let LiveStreamInput {
        request_id,
        decision: initial_decision,
        initial_meta,
        messages,
        options,
        estimated_prompt_tokens,
        cache_key,
        cacheable,
        cache_status,
    } = input;
    async_stream::stream! {
        let mut terminal = TerminalGuard::new(Arc::clone(&state));
        let started = Instant::now();
        yield Ok(json_event("meta", &initial_meta));
        let mut decision = initial_decision;
        let mut fallback_attempted = false;
        let mut accumulated = String::new();
        let mut first_token_at: Option<Instant> = None;
        let mut final_chunk: Option<OllamaChunk> = None;

        loop {
            let Some(model) = state.config.models.iter().find(|model| model.name == decision.model).cloned() else {
                terminal.complete();
                yield Ok(json_event("error", &StreamErrorEvent { code: "MODEL_NOT_FOUND".to_owned(), message: "Requested model is not configured.".to_owned(), request_id }));
                return;
            };
            let permit = match state.queue.acquire(&model.name).await {
                Ok(permit) => permit,
                Err(QueueError::Full) => {
                    terminal.complete();
                    yield Ok(json_event("error", &StreamErrorEvent { code: "QUEUE_FULL".to_owned(), message: "The selected model queue is full. Try again shortly.".to_owned(), request_id }));
                    return;
                }
                Err(QueueError::Closed | QueueError::UnknownModel) => {
                    terminal.complete();
                    yield Ok(json_event("error", &StreamErrorEvent { code: "INTERNAL".to_owned(), message: "The model queue is unavailable.".to_owned(), request_id }));
                    return;
                }
            };
            let source = state.backend.chat_stream(&model, messages.clone(), options.clone()).await;
            let mut source = match source {
                Ok(source) => source,
                Err(error) => {
                    drop(permit);
                    if !fallback_attempted {
                        if let Some(next) = fallback_decision(&state, &decision, request_id, &cache_status) {
                            fallback_attempted = true;
                            let fallback_from = decision.model.clone();
                            state.metrics.fallbacks.inc();
                            let meta = meta_for(request_id, &next, cache_status.clone(), Some(fallback_from));
                            decision = next;
                            yield Ok(json_event("meta", &meta));
                            continue;
                        }
                    }
                    let code = ollama_error_code(&error);
                    terminal.complete();
                    yield Ok(json_event("error", &StreamErrorEvent { code: code.to_owned(), message: public_ollama_message(&error), request_id }));
                    return;
                }
            };

            let mut completed = false;
            let mut upstream_error: Option<OllamaError> = None;
            while let Some(next) = source.next().await {
                match next {
                    Ok(chunk) => {
                        if let Some(message) = chunk.message.as_ref() {
                            if !message.content.is_empty() {
                                first_token_at.get_or_insert_with(Instant::now);
                                accumulated.push_str(&message.content);
                                yield Ok(json_event("token", &TokenEvent { text: message.content.clone() }));
                            }
                        }
                        if chunk.done { final_chunk = Some(chunk); completed = true; break; }
                    }
                    Err(error) => { upstream_error = Some(error); break; }
                }
            }
            drop(source);
            drop(permit);
            if completed { break; }

            let error = upstream_error.unwrap_or(OllamaError::Truncated);
            if accumulated.is_empty() && !fallback_attempted {
                if let Some(next) = fallback_decision(&state, &decision, request_id, &cache_status) {
                    fallback_attempted = true;
                    let fallback_from = decision.model.clone();
                    state.metrics.fallbacks.inc();
                    let meta = meta_for(request_id, &next, cache_status.clone(), Some(fallback_from));
                    decision = next;
                    yield Ok(json_event("meta", &meta));
                    continue;
                }
            }
            let code = ollama_error_code(&error);
            terminal.complete();
            yield Ok(json_event("error", &StreamErrorEvent { code: code.to_owned(), message: public_ollama_message(&error), request_id }));
            return;
        }

        let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;
        let first_ms = first_token_at.map(|instant| instant.duration_since(started).as_secs_f64() * 1000.0).unwrap_or(elapsed_ms);
        let chunk = final_chunk.unwrap_or_default();
        let completion_tokens = chunk.eval_count.unwrap_or_else(|| accumulated.split_whitespace().count() as u32);
        let prompt_tokens = chunk.prompt_eval_count.unwrap_or(estimated_prompt_tokens);
        let total_ms = chunk.total_duration.map(|value| value as f64 / 1_000_000.0).filter(|value| *value > 0.0).unwrap_or(elapsed_ms);
        let load_ms = chunk.load_duration.map(|value| value as f64 / 1_000_000.0).unwrap_or(0.0);
        let eval_ms = chunk.eval_duration.map(|value| value as f64 / 1_000_000.0).unwrap_or(total_ms.max(1.0));
        let usage = Usage { prompt_tokens, completion_tokens, ttft_ms: first_ms, total_ms, tokens_per_sec: completion_tokens as f64 / (eval_ms / 1000.0).max(0.001), load_ms };
        state.metrics.ttft.observe(first_ms / 1000.0);
        state.set_loaded_model(&decision.model);
        state.record_decision(&decision, cache_status.clone(), total_ms).await;
        if cacheable && !accumulated.is_empty() {
            let cached = CachedResponse { text: accumulated, decision: decision.clone(), usage: usage.clone(), created_at: Utc::now() };
            if let Err(error) = state.cache.set(&cache_key, &cached, Duration::from_secs(state.config.cache_ttl_seconds)).await {
                state.metrics.cache_errors.inc();
                tracing::warn!(request_id = %request_id, %error, "cache store failed; response still served");
            }
        }
        yield Ok(json_event("done", &DoneEvent { request_id, usage }));
        terminal.complete();
    }
}

fn fallback_decision(
    state: &AppState,
    current: &crate::models::RouteDecision,
    request_id: Uuid,
    _cache: &CacheStatus,
) -> Option<crate::models::RouteDecision> {
    if !state.config.routing.fallback_enabled {
        return None;
    }
    let fallback_name = current.fallback.as_deref()?;
    let model = state
        .config
        .models
        .iter()
        .find(|model| model.name == fallback_name)?;
    let tier = crate::models::Tier::parse(&model.tier)?;
    let reason = format!("{}; fell back after upstream failure", current.reason);
    tracing::warn!(request_id = %request_id, from_model = %current.model, to_model = %model.name, "trying one fallback model");
    Some(crate::models::RouteDecision {
        model: model.name.clone(),
        tier,
        score: current.score,
        intent: current.intent.clone(),
        reason,
        swap_expected: true,
        fallback: model.fallback.clone(),
        queue_depth: state.queue.depth(&model.name),
    })
}

fn meta_for(
    request_id: Uuid,
    decision: &crate::models::RouteDecision,
    cache: CacheStatus,
    fallback_from: Option<String>,
) -> MetaEvent {
    MetaEvent {
        request_id,
        model: decision.model.clone(),
        tier: decision.tier.clone(),
        score: decision.score,
        intent: decision.intent.clone(),
        reason: decision.reason.clone(),
        cache,
        swap_expected: decision.swap_expected,
        fallback_from,
    }
}

fn ollama_error_code(error: &OllamaError) -> &'static str {
    match error {
        OllamaError::Request(inner) if inner.is_timeout() => "UPSTREAM_TIMEOUT",
        _ => "UPSTREAM_UNAVAILABLE",
    }
}
fn public_ollama_message(error: &OllamaError) -> String {
    if ollama_error_code(error) == "UPSTREAM_TIMEOUT" {
        "The selected model did not finish in time.".to_owned()
    } else {
        "The local model backend failed to complete the response.".to_owned()
    }
}

fn cache_replay_chunks(text: &str) -> Vec<String> {
    let chars = text.chars().collect::<Vec<_>>();
    chars
        .chunks(20)
        .map(|chunk| chunk.iter().collect())
        .collect()
}

fn json_event<T: Serialize>(name: &str, value: &T) -> Event {
    match serde_json::to_string(value) {
        Ok(json) => Event::default().event(name).data(json),
        Err(error) => {
            tracing::error!(%error, "SSE event serialization failed");
            Event::default()
                .event("error")
                .data("{\"code\":\"INTERNAL\",\"message\":\"Event serialization failed.\"}")
        }
    }
}

fn sse_response<S>(request_id: Uuid, stream: S) -> Response
where
    S: Stream<Item = Result<Event, Infallible>> + Send + 'static,
{
    let mut response = Sse::new(stream)
        .keep_alive(
            KeepAlive::new()
                .interval(super::handlers::heartbeat_interval())
                .text("ping"),
        )
        .into_response();
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-cache, no-transform"),
    );
    response
        .headers_mut()
        .insert(header::CONNECTION, HeaderValue::from_static("keep-alive"));
    response.headers_mut().insert(
        HeaderName::from_static("x-accel-buffering"),
        HeaderValue::from_static("no"),
    );
    if let Ok(value) = HeaderValue::from_str(&request_id.to_string()) {
        response
            .headers_mut()
            .insert(HeaderName::from_static("x-request-id"), value);
    }
    response
}

struct TerminalGuard {
    state: Arc<AppState>,
    complete: bool,
}
impl TerminalGuard {
    fn new(state: Arc<AppState>) -> Self {
        Self {
            state,
            complete: false,
        }
    }
    fn complete(&mut self) {
        self.complete = true;
    }
}
impl Drop for TerminalGuard {
    fn drop(&mut self) {
        if !self.complete {
            self.state.metrics.client_aborts.inc();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ChatOptions, Message, Role};

    #[test]
    fn cache_replay_chunks_keep_unicode_boundaries() {
        let chunks = cache_replay_chunks("ab🧠cd");
        assert_eq!(chunks.concat(), "ab🧠cd");
    }
    #[test]
    fn cache_replay_does_not_emit_empty_chunks() {
        assert!(cache_replay_chunks("").is_empty());
    }
    #[test]
    fn cache_key_uses_model_independent_input() {
        let message = vec![Message {
            role: Role::User,
            content: "hi".into(),
        }];
        let key = cache_key(&message, &ChatOptions::default());
        assert_eq!(key.len(), 64);
    }
}

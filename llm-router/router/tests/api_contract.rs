use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
    Router,
};
use llm_router::{
    api,
    cache::{CacheStore, InMemoryCache},
    config::{AppConfig, ModelRegistry, RoutingFile},
    metrics::Metrics,
    ollama::OllamaBackend,
    queue::QueueManager,
    state::AppState,
};
use serde_json::{json, Value};
use std::sync::Arc;
use tower::ServiceExt;
use wiremock::{
    matchers::{method, path},
    Mock, MockServer, ResponseTemplate,
};

async fn test_router(ollama_url: String) -> Router {
    let registry: ModelRegistry = serde_yaml::from_str(include_str!("../../config/models.yaml"))
        .expect("model config should parse");
    let routing: RoutingFile = serde_yaml::from_str(include_str!("../../config/routing.yaml"))
        .expect("routing config should parse");
    let models = registry.models;
    let queue = QueueManager::new(&models);
    let cache: Arc<dyn CacheStore> = Arc::new(InMemoryCache::default());
    let metrics = Arc::new(Metrics::new().expect("metrics should register"));
    let backend = OllamaBackend::new(ollama_url.clone(), 5_000).expect("HTTP client should build");
    let config = AppConfig {
        bind_host: "127.0.0.1".to_owned(),
        port: 0,
        ollama_url,
        redis_url: "redis://127.0.0.1:6379".to_owned(),
        request_timeout_ms: 5_000,
        cache_enabled: true,
        cache_ttl_seconds: routing.routing.cache_ttl_seconds,
        cache_max_temperature: routing.routing.cache_max_temperature,
        models,
        classifier: routing.classifier,
        routing: routing.routing,
    };
    let state = AppState::new(config, backend, cache, metrics, queue)
        .expect("shared app state should initialize");
    api::router(state)
}

async fn request_json(
    app: &Router,
    method_name: &str,
    uri: &str,
    body: Option<Value>,
) -> axum::response::Response {
    let mut builder = Request::builder().method(method_name).uri(uri);
    if body.is_some() {
        builder = builder.header("content-type", "application/json");
    }
    let request = builder
        .body(
            body.map(|value| Body::from(value.to_string()))
                .unwrap_or_else(Body::empty),
        )
        .expect("test request should build");
    app.clone()
        .oneshot(request)
        .await
        .expect("router should respond")
}

#[tokio::test]
async fn health_aggregates_ollama_and_cache_status() {
    let mock = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/tags"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "models": [] })))
        .mount(&mock)
        .await;

    let app = test_router(mock.uri()).await;
    let response = request_json(&app, "GET", "/healthz", None).await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), 64 * 1024)
        .await
        .expect("health response body should be readable");
    let value: Value = serde_json::from_slice(&body).expect("health response should be JSON");
    assert_eq!(value["status"], "healthy");
    assert_eq!(value["services"]["ollama"]["status"], "healthy");
    assert_eq!(value["services"]["redis"]["status"], "healthy");
}

#[tokio::test]
async fn preview_returns_a_contract_shaped_routing_decision() {
    let mock = MockServer::start().await;
    let app = test_router(mock.uri()).await;
    let response = request_json(
        &app,
        "POST",
        "/v1/route/preview",
        Some(json!({ "messages": [{ "role": "user", "content": "Write a Python function to reverse a string." }] })),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), 64 * 1024)
        .await
        .expect("preview response body should be readable");
    let value: Value = serde_json::from_slice(&body).expect("preview response should be JSON");
    assert_eq!(value["tier"], "code");
    assert_eq!(value["intent"], "code");
    assert!(value["model"].is_string());
    assert!(value["score"].as_u64().is_some());
    assert!(value["reason"].is_string());
}

#[tokio::test]
async fn chat_stream_proxies_ndjson_as_meta_token_done_sse() {
    let mock = MockServer::start().await;
    let chunks = concat!(
        "{\"model\":\"qwen2.5:1.5b\",\"message\":{\"role\":\"assistant\",\"content\":\"hello \"},\"done\":false}\n",
        "{\"model\":\"qwen2.5:1.5b\",\"message\":{\"role\":\"assistant\",\"content\":\"world\"},\"done\":false}\n",
        "{\"model\":\"qwen2.5:1.5b\",\"message\":{\"role\":\"assistant\",\"content\":\"\"},\"done\":true,\"total_duration\":10000000,\"load_duration\":0,\"prompt_eval_count\":3,\"eval_count\":2,\"eval_duration\":5000000}\n",
    );
    Mock::given(method("POST"))
        .and(path("/api/chat"))
        .respond_with(ResponseTemplate::new(200).set_body_raw(chunks, "application/x-ndjson"))
        .mount(&mock)
        .await;

    let app = test_router(mock.uri()).await;
    let response = request_json(
        &app,
        "POST",
        "/v1/route/chat",
        Some(json!({
            "messages": [{ "role": "user", "content": "hello" }],
            "mode": "force",
            "model": "qwen2.5:1.5b",
            "use_cache": false
        })),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    assert!(response.headers().contains_key("x-request-id"));
    assert_eq!(
        response.headers()["content-type"]
            .to_str()
            .unwrap_or_default()
            .split(';')
            .next(),
        Some("text/event-stream")
    );
    let body = to_bytes(response.into_body(), 64 * 1024)
        .await
        .expect("SSE response body should be readable");
    let text = String::from_utf8(body.to_vec()).expect("SSE body should be UTF-8");
    let meta = text
        .find("event: meta")
        .expect("meta event should be first");
    let token = text
        .find("event: token")
        .expect("token event should follow meta");
    let done = text
        .find("event: done")
        .expect("done event should terminate stream");
    assert!(meta < token && token < done);
    assert!(text.contains("hello "));
    assert!(text.contains("world"));
    assert!(text.contains("\"load_ms\":0.0"));
}

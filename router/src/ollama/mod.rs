use crate::{
    config::ModelConfig,
    models::{ChatOptions, Message},
};
use bytes::Bytes;
use futures_util::{stream::BoxStream, StreamExt};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum OllamaError {
    #[error("ollama request failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("ollama returned status {0}")]
    Status(u16),
    #[error("invalid Ollama NDJSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("ollama stream was truncated")]
    Truncated,
}

/// Ollama-compatible stream chunk, including final timing and token counters.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct OllamaChunk {
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub message: Option<OllamaMessage>,
    #[serde(default)]
    pub done: bool,
    #[serde(default)]
    pub total_duration: Option<u64>,
    #[serde(default)]
    pub load_duration: Option<u64>,
    #[serde(default)]
    pub prompt_eval_count: Option<u32>,
    #[serde(default)]
    pub prompt_eval_duration: Option<u64>,
    #[serde(default)]
    pub eval_count: Option<u32>,
    #[serde(default)]
    pub eval_duration: Option<u64>,
}
/// Assistant message delta from Ollama.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct OllamaMessage {
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub content: String,
}

/// Typed async client for Ollama's `/api/chat`, `/api/tags` and `/api/ps`.
#[derive(Clone)]
pub struct OllamaBackend {
    client: Client,
    base_url: String,
    default_timeout: Duration,
}
impl OllamaBackend {
    /// Create a client with explicit request and connect timeouts.
    pub fn new(base_url: String, timeout_ms: u64) -> Result<Self, reqwest::Error> {
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_millis(timeout_ms))
            .build()?;
        Ok(Self {
            client,
            base_url: base_url.trim_end_matches('/').to_owned(),
            default_timeout: Duration::from_millis(timeout_ms),
        })
    }

    /// Start a streamed chat request and parse NDJSON across arbitrary network chunk boundaries.
    pub async fn chat_stream(
        &self,
        model: &ModelConfig,
        messages: Vec<Message>,
        options: ChatOptions,
    ) -> Result<BoxStream<'static, Result<OllamaChunk, OllamaError>>, OllamaError> {
        let url = format!("{}/api/chat", self.base_url);
        let body = OllamaChatRequest {
            model: &model.name,
            messages,
            stream: true,
            options,
        };
        let response = self
            .client
            .post(url)
            .timeout(
                Duration::from_millis(model.timeout_ms).min(
                    self.default_timeout
                        .max(Duration::from_millis(model.timeout_ms)),
                ),
            )
            .json(&body)
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(OllamaError::Status(response.status().as_u16()));
        }
        let source = response.bytes_stream();
        let stream = async_stream::try_stream! {
            let mut pending = Vec::<u8>::new();
            futures_util::pin_mut!(source);
            while let Some(chunk) = source.next().await {
                let chunk: Bytes = chunk?;
                pending.extend_from_slice(&chunk);
                while let Some(index) = pending.iter().position(|byte| *byte == b'\n') {
                    let line: Vec<u8> = pending.drain(..=index).collect();
                    let line = line.iter().copied().filter(|byte| *byte != b'\n' && *byte != b'\r').collect::<Vec<_>>();
                    if line.is_empty() { continue; }
                    let parsed = serde_json::from_slice::<OllamaChunk>(&line)?;
                    yield parsed;
                }
            }
            if !pending.iter().all(u8::is_ascii_whitespace) {
                let parsed = serde_json::from_slice::<OllamaChunk>(&pending)?;
                yield parsed;
            }
        };
        Ok(Box::pin(stream))
    }

    /// Return tags from Ollama; callers may degrade health when the request fails.
    pub async fn tags(&self) -> Result<Vec<String>, OllamaError> {
        let response = self
            .client
            .get(format!("{}/api/tags", self.base_url))
            .timeout(Duration::from_secs(3))
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(OllamaError::Status(response.status().as_u16()));
        }
        let result: TagsResponse = response.json().await?;
        Ok(result.models.into_iter().map(|model| model.name).collect())
    }

    /// Return currently-loaded model details from Ollama `/api/ps`.
    pub async fn loaded_models(&self) -> Result<Vec<LoadedModel>, OllamaError> {
        let response = self
            .client
            .get(format!("{}/api/ps", self.base_url))
            .timeout(Duration::from_secs(3))
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(OllamaError::Status(response.status().as_u16()));
        }
        let result: PsResponse = response.json().await?;
        Ok(result.models)
    }
}

#[derive(Serialize)]
struct OllamaChatRequest<'a> {
    model: &'a str,
    messages: Vec<Message>,
    stream: bool,
    options: ChatOptions,
}
#[derive(Deserialize)]
struct TagsResponse {
    #[serde(default)]
    models: Vec<TagModel>,
}
#[derive(Deserialize)]
struct TagModel {
    name: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct LoadedModel {
    pub name: String,
    #[serde(default)]
    pub size: u64,
    #[serde(default)]
    pub size_vram: u64,
    #[serde(default)]
    pub expires_at: Option<String>,
}
#[derive(Deserialize)]
struct PsResponse {
    #[serde(default)]
    models: Vec<LoadedModel>,
}

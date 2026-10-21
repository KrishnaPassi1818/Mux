use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Supported chat roles.
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    System,
    User,
    Assistant,
}

/// Routing behavior requested by the API caller.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    #[default]
    Auto,
    Force,
}

/// Model tier configured in the registry.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Tier {
    Light,
    Code,
    Heavy,
}

impl Tier {
    /// Convert configured tier text into a typed tier.
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "light" => Some(Self::Light),
            "code" => Some(Self::Code),
            "heavy" => Some(Self::Heavy),
            _ => None,
        }
    }
    /// Stable label for logs, metrics and JSON.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Light => "light",
            Self::Code => "code",
            Self::Heavy => "heavy",
        }
    }
}

/// Detected broad user intent.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Intent {
    Chat,
    Code,
    Reasoning,
}

/// One user/system/assistant turn.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Message {
    pub role: Role,
    pub content: String,
}

/// Sampling and context options passed to Ollama.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChatOptions {
    #[serde(default = "default_temperature")]
    pub temperature: f32,
    #[serde(default = "default_top_p")]
    pub top_p: f32,
    #[serde(default = "default_context")]
    pub num_ctx: u32,
    #[serde(default)]
    pub num_predict: Option<u32>,
}
impl Default for ChatOptions {
    fn default() -> Self {
        Self {
            temperature: default_temperature(),
            top_p: default_top_p(),
            num_ctx: default_context(),
            num_predict: None,
        }
    }
}
fn default_temperature() -> f32 {
    0.2
}
fn default_top_p() -> f32 {
    0.9
}
fn default_context() -> u32 {
    4096
}

/// API chat request. `request_id` is injected from the HTTP header when absent.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChatRequest {
    pub messages: Vec<Message>,
    #[serde(default)]
    pub mode: Mode,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub options: ChatOptions,
    #[serde(default = "default_true")]
    pub use_cache: bool,
    #[serde(default)]
    pub request_id: Option<Uuid>,
}
/// Dry-run route preview request.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreviewRequest {
    pub messages: Vec<Message>,
    #[serde(default)]
    pub mode: Mode,
    #[serde(default)]
    pub model: Option<String>,
}
fn default_true() -> bool {
    true
}

/// Pure classifier output.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Classification {
    pub score: u8,
    pub intent: Intent,
    pub estimated_tokens: u32,
    pub reasons: Vec<String>,
}

/// Model selected by the policy and the explanation shown to the user.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RouteDecision {
    pub model: String,
    pub tier: Tier,
    pub score: u8,
    pub intent: Intent,
    pub reason: String,
    pub swap_expected: bool,
    pub fallback: Option<String>,
    pub queue_depth: usize,
}

/// Cache status serialized in the `meta` SSE event.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CacheStatus {
    Hit,
    Miss,
    Bypass,
}

/// Initial and fallback routing metadata.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MetaEvent {
    pub request_id: Uuid,
    pub model: String,
    pub tier: Tier,
    pub score: u8,
    pub intent: Intent,
    pub reason: String,
    pub cache: CacheStatus,
    pub swap_expected: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fallback_from: Option<String>,
}
/// Streamed response delta.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TokenEvent {
    pub text: String,
}

/// Inference timing/usage returned in the terminal `done` event.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Usage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub ttft_ms: f64,
    pub total_ms: f64,
    pub tokens_per_sec: f64,
    pub load_ms: f64,
}
/// Terminal success event.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DoneEvent {
    pub request_id: Uuid,
    pub usage: Usage,
}
/// Terminal stream failure event.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StreamErrorEvent {
    pub code: String,
    pub message: String,
    pub request_id: Uuid,
}

/// Fully completed answer stored in cache; partial streams are never represented here.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CachedResponse {
    pub text: String,
    pub decision: RouteDecision,
    pub usage: Usage,
    pub created_at: DateTime<Utc>,
}

/// A recent completed routing decision used by the live dashboard.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DecisionRecord {
    pub id: String,
    pub timestamp: DateTime<Utc>,
    pub model: String,
    pub tier: Tier,
    pub score: u8,
    pub intent: Intent,
    pub reason: String,
    pub latency_ms: f64,
    pub cache: CacheStatus,
}

/// Per-model rolling aggregates.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ModelStats {
    pub model: String,
    pub tier: Tier,
    pub count: u64,
    pub avg_latency_ms: f64,
    pub p95_latency_ms: f64,
}
/// Optional GPU sample; `null` means no supported exporter is configured.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GpuStats {
    pub vram_used_bytes: Option<u64>,
    pub vram_total_bytes: Option<u64>,
    pub utilization_pct: Option<f64>,
}
/// Current rolling-window statistics payload.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StatsResponse {
    pub timestamp: DateTime<Utc>,
    pub window_seconds: u64,
    pub requests_total: u64,
    pub avg_latency_ms: f64,
    pub cache: CacheStats,
    pub swaps: u64,
    pub by_model: Vec<ModelStats>,
    pub recent: Vec<DecisionRecord>,
    pub queue_depth: std::collections::BTreeMap<String, usize>,
    pub loaded_model: Option<String>,
    pub gpu: GpuStats,
    pub estimated_savings: SavingsEstimate,
}
/// Aggregate cache counters.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CacheStats {
    pub hits: u64,
    pub misses: u64,
    pub hit_rate: f64,
}
/// Labeled, calibrated estimate (not a measured benchmark value).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SavingsEstimate {
    pub basis: String,
    pub time_ms: f64,
    pub pct_vs_heavy_only: f64,
}

/// Model registry record and runtime Ollama state.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ModelInfo {
    pub name: String,
    pub tier: Tier,
    pub available: bool,
    pub loaded: bool,
    pub max_concurrency: usize,
    pub timeout_ms: u64,
    pub size_bytes: Option<u64>,
    pub size_vram_bytes: Option<u64>,
}
/// Configured model list response.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ModelsResponse {
    pub models: Vec<ModelInfo>,
}

/// Common JSON error envelope.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ErrorEnvelope {
    pub error: ErrorBody,
}
/// Error code/message/request context.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ErrorBody {
    pub code: String,
    pub message: String,
    pub request_id: Uuid,
}

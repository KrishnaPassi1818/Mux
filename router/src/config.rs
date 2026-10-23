use serde::Deserialize;
use std::{env, fs, path::Path};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("could not read {path}: {source}")]
    Read {
        path: String,
        source: std::io::Error,
    },
    #[error("invalid YAML in {path}: {source}")]
    Parse {
        path: String,
        source: serde_yaml::Error,
    },
    #[error("invalid configuration: {0}")]
    Invalid(String),
}

#[derive(Clone, Debug, Deserialize)]
pub struct ModelRegistry {
    pub models: Vec<ModelConfig>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ModelConfig {
    pub name: String,
    pub tier: String,
    #[serde(default = "default_concurrency")]
    pub max_concurrency: usize,
    #[serde(default = "default_timeout")]
    pub timeout_ms: u64,
    #[serde(default = "default_queue")]
    pub max_queue: usize,
    #[serde(default)]
    pub fallback: Option<String>,
    #[serde(default)]
    pub size_bytes: Option<u64>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct RoutingFile {
    pub classifier: ClassifierConfig,
    pub routing: RoutingConfig,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ClassifierConfig {
    pub weights: ScoreWeights,
    pub simplicity_penalty: f64,
    pub reasoning_min_score: u8,
    pub length_saturation_tokens: usize,
    pub reasoning_keywords: Vec<String>,
    pub code_keywords: Vec<String>,
    pub simple_patterns: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ScoreWeights {
    pub length: f64,
    pub reasoning: f64,
    pub structure: f64,
    pub context: f64,
}

#[derive(Clone, Debug, Deserialize)]
pub struct RoutingConfig {
    pub light_max_score: u8,
    pub heavy_min_score: u8,
    pub warm_stickiness_margin: u8,
    pub max_queue_default: usize,
    pub queue_diversion_enabled: bool,
    pub fallback_enabled: bool,
    pub default_model: String,
    pub cache_ttl_seconds: u64,
    pub cache_max_temperature: f32,
    pub estimated_heavy_tokens_per_second: f64,
    pub stats_window_seconds: u64,
    pub recent_decisions_limit: usize,
}

#[derive(Clone, Debug)]
pub struct AppConfig {
    pub bind_host: String,
    pub port: u16,
    pub ollama_url: String,
    pub redis_url: String,
    pub request_timeout_ms: u64,
    pub cache_enabled: bool,
    pub cache_ttl_seconds: u64,
    pub cache_max_temperature: f32,
    pub models: Vec<ModelConfig>,
    pub classifier: ClassifierConfig,
    pub routing: RoutingConfig,
}

impl AppConfig {
    pub fn load() -> Result<Self, ConfigError> {
        let server_path =
            env::var("SERVER_CONFIG").unwrap_or_else(|_| "config/server.yaml".to_owned());
        let models_path =
            env::var("MODELS_CONFIG").unwrap_or_else(|_| "config/models.yaml".to_owned());
        let routing_path =
            env::var("ROUTING_CONFIG").unwrap_or_else(|_| "config/routing.yaml".to_owned());
        let server: ServerFile = read_yaml(&server_path)?;
        let registry: ModelRegistry = read_yaml(&models_path)?;
        let routing_file: RoutingFile = read_yaml(&routing_path)?;
        let mut config = Self {
            bind_host: env::var("ROUTER_HOST").unwrap_or(server.server.host),
            port: parse_env("ROUTER_PORT", server.server.port)?,
            ollama_url: env::var("OLLAMA_URL").unwrap_or(server.upstream.ollama_url),
            redis_url: env::var("REDIS_URL").unwrap_or(server.upstream.redis_url),
            request_timeout_ms: parse_env(
                "OLLAMA_REQUEST_TIMEOUT_MS",
                server.upstream.request_timeout_ms,
            )?,
            cache_enabled: parse_env("CACHE_ENABLED", server.cache.enabled)?,
            cache_ttl_seconds: parse_env("CACHE_TTL_SECONDS", server.cache.ttl_seconds)?,
            cache_max_temperature: parse_env(
                "CACHE_MAX_TEMPERATURE",
                server.cache.max_temperature,
            )?,
            models: registry.models,
            classifier: routing_file.classifier,
            routing: routing_file.routing,
        };
        if let Ok(value) = env::var("CACHE_TTL_SECONDS") {
            config.routing.cache_ttl_seconds = value.parse().map_err(|_| {
                ConfigError::Invalid("CACHE_TTL_SECONDS must be an unsigned integer".to_owned())
            })?;
        }
        if let Ok(value) = env::var("CACHE_MAX_TEMPERATURE") {
            config.routing.cache_max_temperature = value.parse().map_err(|_| {
                ConfigError::Invalid("CACHE_MAX_TEMPERATURE must be a number".to_owned())
            })?;
            config.cache_max_temperature = config.routing.cache_max_temperature;
        }
        config.validate()?;
        Ok(config)
    }

    fn validate(&self) -> Result<(), ConfigError> {
        if self.models.is_empty() {
            return Err(ConfigError::Invalid(
                "models registry must not be empty".to_owned(),
            ));
        }
        if self.routing.light_max_score >= self.routing.heavy_min_score {
            return Err(ConfigError::Invalid(
                "light_max_score must be below heavy_min_score".to_owned(),
            ));
        }
        if !self
            .models
            .iter()
            .any(|model| model.name == self.routing.default_model)
        {
            return Err(ConfigError::Invalid(
                "default_model must exist in config/models.yaml".to_owned(),
            ));
        }
        if self.models.iter().any(|model| {
            model.name.trim().is_empty() || model.max_concurrency == 0 || model.timeout_ms == 0
        }) {
            return Err(ConfigError::Invalid(
                "each model needs a name, positive concurrency and positive timeout".to_owned(),
            ));
        }
        if self
            .models
            .iter()
            .any(|model| crate::models::Tier::parse(&model.tier).is_none())
        {
            return Err(ConfigError::Invalid(
                "model tiers must be light, code, or heavy".to_owned(),
            ));
        }
        let distinct_names = self
            .models
            .iter()
            .map(|model| &model.name)
            .collect::<std::collections::HashSet<_>>();
        if distinct_names.len() != self.models.len() {
            return Err(ConfigError::Invalid(
                "model names must be unique".to_owned(),
            ));
        }
        if self
            .models
            .iter()
            .filter_map(|model| model.fallback.as_ref())
            .any(|fallback| !self.models.iter().any(|model| &model.name == fallback))
        {
            return Err(ConfigError::Invalid(
                "each configured fallback must reference a known model".to_owned(),
            ));
        }
        if !self.cache_max_temperature.is_finite()
            || !(0.0..=2.0).contains(&self.cache_max_temperature)
        {
            return Err(ConfigError::Invalid(
                "CACHE_MAX_TEMPERATURE must be between 0 and 2".to_owned(),
            ));
        }
        let weights = &self.classifier.weights;
        let weight_sum = weights.length + weights.reasoning + weights.structure + weights.context;
        if !weight_sum.is_finite()
            || (weight_sum - 1.0).abs() > 0.01
            || self.classifier.length_saturation_tokens == 0
            || self.classifier.reasoning_min_score > 100
        {
            return Err(ConfigError::Invalid("classifier weights must sum to 1, length saturation must be positive, and reasoning_min_score must be at most 100".to_owned()));
        }
        if !self.ollama_url.starts_with("http://") && !self.ollama_url.starts_with("https://") {
            return Err(ConfigError::Invalid(
                "OLLAMA_URL must use http or https".to_owned(),
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
struct ServerFile {
    server: ServerSettings,
    upstream: UpstreamSettings,
    cache: CacheSettings,
}
#[derive(Debug, Deserialize)]
struct ServerSettings {
    host: String,
    port: u16,
}
#[derive(Debug, Deserialize)]
struct UpstreamSettings {
    ollama_url: String,
    redis_url: String,
    request_timeout_ms: u64,
}
#[derive(Debug, Deserialize)]
struct CacheSettings {
    enabled: bool,
    ttl_seconds: u64,
    max_temperature: f32,
}

fn read_yaml<T: for<'de> Deserialize<'de>>(path: &str) -> Result<T, ConfigError> {
    let content = fs::read_to_string(Path::new(path)).map_err(|source| ConfigError::Read {
        path: path.to_owned(),
        source,
    })?;
    serde_yaml::from_str(&content).map_err(|source| ConfigError::Parse {
        path: path.to_owned(),
        source,
    })
}
fn parse_env<T: std::str::FromStr>(name: &str, fallback: T) -> Result<T, ConfigError> {
    match env::var(name) {
        Ok(value) => value
            .parse()
            .map_err(|_| ConfigError::Invalid(format!("{name} has an invalid value"))),
        Err(_) => Ok(fallback),
    }
}
fn default_concurrency() -> usize {
    1
}
fn default_timeout() -> u64 {
    90_000
}
fn default_queue() -> usize {
    6
}

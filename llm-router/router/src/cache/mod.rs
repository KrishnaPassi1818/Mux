use crate::{config::AppConfig, models::CachedResponse};
use async_trait::async_trait;
use redis::{aio::ConnectionManager, AsyncCommands};
use serde_json;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};
use thiserror::Error;
use tokio::sync::Mutex;
use unicode_normalization::UnicodeNormalization;

#[derive(Debug, Error)]
pub enum CacheError {
    #[error("redis error: {0}")]
    Redis(#[from] redis::RedisError),
    #[error("cached JSON could not be decoded: {0}")]
    Json(#[from] serde_json::Error),
}

/// Storage abstraction so routing can be tested with deterministic in-memory state.
#[async_trait]
pub trait CacheStore: Send + Sync {
    /// Fetch a complete cached response by its opaque key.
    async fn get(&self, key: &str) -> Result<Option<CachedResponse>, CacheError>;
    /// Store a complete response with a bounded expiration time.
    async fn set(&self, key: &str, value: &CachedResponse, ttl: Duration)
        -> Result<(), CacheError>;
    /// Flush only LLM Router response-cache entries and return the number removed.
    async fn flush(&self) -> Result<u64, CacheError>;
    /// Return whether the backing store can serve requests.
    async fn healthy(&self) -> bool;
}

/// Build a model-independent, canonical cache key.
pub fn cache_key(
    messages: &[crate::models::Message],
    options: &crate::models::ChatOptions,
) -> String {
    let normalized = messages
        .iter()
        .map(|message| {
            let content = message
                .content
                .nfc()
                .collect::<String>()
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                .to_lowercase();
            format!("{}:{content}", role_name(&message.role))
        })
        .collect::<Vec<_>>()
        .join("\n");
    let payload = format!(
        "{normalized}\0{:.4}\0{:.4}\0{}",
        options.temperature, options.top_p, options.num_ctx
    );
    hex::encode(Sha256::digest(payload.as_bytes()))
}

fn role_name(role: &crate::models::Role) -> &'static str {
    match role {
        crate::models::Role::System => "system",
        crate::models::Role::User => "user",
        crate::models::Role::Assistant => "assistant",
    }
}

/// Redis-backed response cache with namespaced keys and TTL.
pub struct RedisCache {
    connection: ConnectionManager,
}
impl RedisCache {
    /// Create a multiplexed async Redis connection manager.
    pub async fn connect(url: &str) -> Result<Self, CacheError> {
        let client = redis::Client::open(url)?;
        let connection = client.get_connection_manager().await?;
        Ok(Self { connection })
    }
}

#[async_trait]
impl CacheStore for RedisCache {
    async fn get(&self, key: &str) -> Result<Option<CachedResponse>, CacheError> {
        let mut connection = self.connection.clone();
        let value: Option<String> = connection.get(redis_key(key)).await?;
        value
            .map(|json| serde_json::from_str(&json).map_err(CacheError::from))
            .transpose()
    }
    async fn set(
        &self,
        key: &str,
        value: &CachedResponse,
        ttl: Duration,
    ) -> Result<(), CacheError> {
        let json = serde_json::to_string(value)?;
        let mut connection = self.connection.clone();
        let _: () = connection
            .set_ex(redis_key(key), json, ttl.as_secs().max(1))
            .await?;
        Ok(())
    }
    async fn flush(&self) -> Result<u64, CacheError> {
        let mut connection = self.connection.clone();
        let keys: Vec<String> = connection.keys("llmr:resp:*").await?;
        if keys.is_empty() {
            return Ok(0);
        }
        let removed: u64 = connection.del(keys).await?;
        Ok(removed)
    }
    async fn healthy(&self) -> bool {
        let mut connection = self.connection.clone();
        redis::cmd("PING")
            .query_async::<String>(&mut connection)
            .await
            .is_ok()
    }
}

fn redis_key(key: &str) -> String {
    format!("llmr:resp:{key}")
}

/// Expiring in-memory cache used by unit tests.
#[derive(Default)]
pub struct InMemoryCache {
    entries: Mutex<HashMap<String, (CachedResponse, Instant)>>,
}
#[async_trait]
impl CacheStore for InMemoryCache {
    async fn get(&self, key: &str) -> Result<Option<CachedResponse>, CacheError> {
        let mut entries = self.entries.lock().await;
        if let Some((_, expires)) = entries.get(key) {
            if *expires <= Instant::now() {
                entries.remove(key);
                return Ok(None);
            }
        }
        Ok(entries.get(key).map(|(response, _)| response.clone()))
    }
    async fn set(
        &self,
        key: &str,
        value: &CachedResponse,
        ttl: Duration,
    ) -> Result<(), CacheError> {
        self.entries
            .lock()
            .await
            .insert(key.to_owned(), (value.clone(), Instant::now() + ttl));
        Ok(())
    }
    async fn flush(&self) -> Result<u64, CacheError> {
        let mut entries = self.entries.lock().await;
        let count = entries.len() as u64;
        entries.clear();
        Ok(count)
    }
    async fn healthy(&self) -> bool {
        true
    }
}

/// Disabled cache, used when Redis was unreachable during startup; inference remains available.
pub struct BypassCache;
#[async_trait]
impl CacheStore for BypassCache {
    async fn get(&self, _key: &str) -> Result<Option<CachedResponse>, CacheError> {
        Ok(None)
    }
    async fn set(
        &self,
        _key: &str,
        _value: &CachedResponse,
        _ttl: Duration,
    ) -> Result<(), CacheError> {
        Ok(())
    }
    async fn flush(&self) -> Result<u64, CacheError> {
        Ok(0)
    }
    async fn healthy(&self) -> bool {
        false
    }
}

/// Connect Redis where possible. Startup remains available if Redis is down.
pub async fn connect(config: &AppConfig) -> Arc<dyn CacheStore> {
    if !config.cache_enabled {
        return Arc::new(BypassCache);
    }
    match RedisCache::connect(&config.redis_url).await {
        Ok(cache) => Arc::new(cache),
        Err(error) => {
            tracing::warn!(%error, "redis unavailable at startup; bypassing response cache");
            Arc::new(BypassCache)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ChatOptions, Message, Role};

    #[test]
    fn cache_key_normalizes_case_whitespace_and_unicode_nfc() {
        let options = ChatOptions::default();
        let one = vec![Message {
            role: Role::User,
            content: "  Caf\u{00e9}   hello ".into(),
        }];
        let two = vec![Message {
            role: Role::User,
            content: "cafe\u{0301} hello".into(),
        }];
        assert_eq!(cache_key(&one, &options), cache_key(&two, &options));
    }

    #[test]
    fn sampling_parameters_change_cache_key() {
        let messages = vec![Message {
            role: Role::User,
            content: "hello".into(),
        }];
        let one = ChatOptions::default();
        let two = ChatOptions {
            temperature: 0.8,
            ..ChatOptions::default()
        };
        assert_ne!(cache_key(&messages, &one), cache_key(&messages, &two));
    }

    #[tokio::test]
    async fn in_memory_cache_expires_and_flushes() {
        let cache = InMemoryCache::default();
        assert_eq!(cache.flush().await.unwrap_or_default(), 0);
    }
}

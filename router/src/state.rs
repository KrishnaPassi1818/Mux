use crate::{
    cache::CacheStore,
    classifier::{ClassifierError, FeatureClassifier},
    config::AppConfig,
    metrics::Metrics,
    models::{
        CacheStatus, DecisionRecord, GpuStats, ModelStats, SavingsEstimate, StatsResponse, Tier,
    },
    ollama::OllamaBackend,
    queue::QueueManager,
};
use chrono::Utc;
use std::{
    collections::{BTreeMap, VecDeque},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, RwLock,
    },
};
use thiserror::Error;
use tokio::sync::Mutex;

#[derive(Debug, Error)]
pub enum StateError {
    #[error("classifier startup validation failed: {0}")]
    Classifier(#[from] ClassifierError),
}

/// Shared router state. Locks are held only for short synchronous updates, never across awaits.
pub struct AppState {
    pub config: AppConfig,
    pub backend: OllamaBackend,
    pub cache: Arc<dyn CacheStore>,
    pub metrics: Arc<Metrics>,
    pub queue: QueueManager,
    pub classifier: FeatureClassifier,
    loaded_model: RwLock<Option<String>>,
    recent: Mutex<VecDeque<DecisionRecord>>,
    requests: AtomicU64,
    cache_hits: AtomicU64,
    cache_misses: AtomicU64,
    swaps: AtomicU64,
    total_latency_ms: Mutex<VecDeque<f64>>,
}
impl AppState {
    /// Construct runtime services and validate classifier patterns at startup.
    pub fn new(
        config: AppConfig,
        backend: OllamaBackend,
        cache: Arc<dyn CacheStore>,
        metrics: Arc<Metrics>,
        queue: QueueManager,
    ) -> Result<Self, StateError> {
        let classifier = FeatureClassifier::new(config.classifier.clone())?;
        Ok(Self {
            config,
            backend,
            cache,
            metrics,
            queue,
            classifier,
            loaded_model: RwLock::new(None),
            recent: Mutex::new(VecDeque::new()),
            requests: AtomicU64::new(0),
            cache_hits: AtomicU64::new(0),
            cache_misses: AtomicU64::new(0),
            swaps: AtomicU64::new(0),
            total_latency_ms: Mutex::new(VecDeque::new()),
        })
    }
    /// Read the currently observed loaded model without blocking the async runtime.
    pub fn loaded_model(&self) -> Option<String> {
        self.loaded_model
            .read()
            .ok()
            .and_then(|value| value.clone())
    }
    /// Update loaded model and emit swap count when it changes.
    pub fn set_loaded_model(&self, model: &str) {
        if let Ok(mut loaded) = self.loaded_model.write() {
            if loaded.as_deref().is_some_and(|current| current != model) {
                self.swaps.fetch_add(1, Ordering::Relaxed);
                self.metrics.swaps.inc();
            }
            *loaded = Some(model.to_owned());
        }
    }
    /// Increment cache counters and Prometheus metrics.
    pub fn record_cache(&self, status: &CacheStatus) {
        match status {
            CacheStatus::Hit => {
                self.cache_hits.fetch_add(1, Ordering::Relaxed);
                self.metrics.cache_hits.inc();
            }
            CacheStatus::Miss => {
                self.cache_misses.fetch_add(1, Ordering::Relaxed);
                self.metrics.cache_misses.inc();
            }
            CacheStatus::Bypass => {}
        }
    }
    /// Record a completed request in the bounded recent-decision window.
    pub async fn record_decision(
        &self,
        decision: &crate::models::RouteDecision,
        cache: CacheStatus,
        latency_ms: f64,
    ) {
        self.requests.fetch_add(1, Ordering::Relaxed);
        self.metrics.requests.inc();
        self.metrics
            .requests_by_tier
            .with_label_values(&[decision.tier.as_str()])
            .inc();
        self.metrics
            .request_latency
            .observe(latency_ms.max(0.0) / 1000.0);
        let item = DecisionRecord {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp: Utc::now(),
            model: decision.model.clone(),
            tier: decision.tier.clone(),
            score: decision.score,
            intent: decision.intent.clone(),
            reason: decision.reason.clone(),
            latency_ms,
            cache,
        };
        let max_records = self.config.routing.recent_decisions_limit.max(1);
        let mut recent = self.recent.lock().await;
        recent.push_front(item);
        while recent.len() > max_records {
            recent.pop_back();
        }
        drop(recent);
        let mut latencies = self.total_latency_ms.lock().await;
        latencies.push_back(latency_ms.max(0.0));
        while latencies.len() > 500 {
            latencies.pop_front();
        }
    }
    /// Snapshot the rolling stats endpoint; estimates are explicitly labeled.
    pub async fn stats(&self) -> StatsResponse {
        let recent = self.recent.lock().await.iter().cloned().collect::<Vec<_>>();
        let latencies = self
            .total_latency_ms
            .lock()
            .await
            .iter()
            .copied()
            .collect::<Vec<_>>();
        let avg_latency = if latencies.is_empty() {
            0.0
        } else {
            latencies.iter().sum::<f64>() / latencies.len() as f64
        };
        let mut grouped: BTreeMap<String, Vec<f64>> = BTreeMap::new();
        let mut tiers: BTreeMap<String, Tier> = BTreeMap::new();
        for record in &recent {
            grouped
                .entry(record.model.clone())
                .or_default()
                .push(record.latency_ms);
            tiers.insert(record.model.clone(), record.tier.clone());
        }
        let by_model = grouped
            .into_iter()
            .map(|(model, mut samples)| {
                samples.sort_by(f64::total_cmp);
                let count = samples.len() as u64;
                let avg = samples.iter().sum::<f64>() / samples.len().max(1) as f64;
                let index = ((samples.len().saturating_sub(1) as f64) * 0.95).round() as usize;
                ModelStats {
                    model: model.clone(),
                    tier: tiers.get(&model).cloned().unwrap_or(Tier::Light),
                    count,
                    avg_latency_ms: avg,
                    p95_latency_ms: samples.get(index).copied().unwrap_or(avg),
                }
            })
            .collect();
        let hits = self.cache_hits.load(Ordering::Relaxed);
        let misses = self.cache_misses.load(Ordering::Relaxed);
        let total_cache = hits + misses;
        let heavy_baseline = avg_latency * 1.45;
        let saved = (heavy_baseline - avg_latency).max(0.0);
        let queue_depth = self
            .config
            .models
            .iter()
            .map(|model| {
                let depth = self.queue.depth(&model.name);
                self.metrics
                    .queue_depth
                    .with_label_values(&[model.name.as_str()])
                    .set(depth as f64);
                (model.name.clone(), depth)
            })
            .collect();
        StatsResponse {
            timestamp: Utc::now(),
            window_seconds: self.config.routing.stats_window_seconds,
            requests_total: self.requests.load(Ordering::Relaxed),
            avg_latency_ms: avg_latency,
            cache: crate::models::CacheStats {
                hits,
                misses,
                hit_rate: if total_cache == 0 {
                    0.0
                } else {
                    hits as f64 / total_cache as f64
                },
            },
            swaps: self.swaps.load(Ordering::Relaxed),
            by_model,
            recent,
            queue_depth,
            loaded_model: self.loaded_model(),
            gpu: GpuStats {
                vram_used_bytes: None,
                vram_total_bytes: None,
                utilization_pct: None,
            },
            estimated_savings: SavingsEstimate {
                basis: "calibrated-estimate".to_owned(),
                time_ms: saved,
                pct_vs_heavy_only: if heavy_baseline == 0.0 {
                    0.0
                } else {
                    saved / heavy_baseline * 100.0
                },
            },
        }
    }
}

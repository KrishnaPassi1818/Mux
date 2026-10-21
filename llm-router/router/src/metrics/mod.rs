use prometheus::{
    Encoder, GaugeVec, Histogram, HistogramOpts, IntCounter, IntCounterVec, Opts, Registry,
    TextEncoder,
};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum MetricsError {
    #[error("could not register metric: {0}")]
    Register(#[from] prometheus::Error),
}

/// Prometheus registry and application-level counters/histograms.
pub struct Metrics {
    pub registry: Registry,
    pub requests: IntCounter,
    pub cache_hits: IntCounter,
    pub cache_misses: IntCounter,
    pub cache_errors: IntCounter,
    pub swaps: IntCounter,
    pub fallbacks: IntCounter,
    pub client_aborts: IntCounter,
    pub partial_offloads: IntCounter,
    pub requests_by_tier: IntCounterVec,
    pub request_latency: Histogram,
    pub ttft: Histogram,
    pub queue_depth: GaugeVec,
}

impl Metrics {
    /// Register the complete low-cardinality `llmr_` metric set.
    pub fn new() -> Result<Self, MetricsError> {
        let registry = Registry::new();
        let requests = IntCounter::with_opts(Opts::new(
            "llmr_requests_total",
            "Completed routed chat requests.",
        ))?;
        let cache_hits =
            IntCounter::with_opts(Opts::new("llmr_cache_hits_total", "Response-cache hits."))?;
        let cache_misses = IntCounter::with_opts(Opts::new(
            "llmr_cache_misses_total",
            "Response-cache misses.",
        ))?;
        let cache_errors = IntCounter::with_opts(Opts::new(
            "llmr_cache_errors_total",
            "Cache errors bypassed while serving.",
        ))?;
        let swaps = IntCounter::with_opts(Opts::new(
            "llmr_model_swaps_total",
            "Observed model changes between completed requests.",
        ))?;
        let fallbacks = IntCounter::with_opts(Opts::new(
            "llmr_fallbacks_total",
            "Single fallback attempts after an upstream failure.",
        ))?;
        let client_aborts = IntCounter::with_opts(Opts::new(
            "llmr_client_aborts_total",
            "Downstream client cancellations.",
        ))?;
        let partial_offloads = IntCounter::with_opts(Opts::new(
            "llmr_partial_offload_total",
            "Ollama models not fully resident in VRAM.",
        ))?;
        let requests_by_tier = IntCounterVec::new(
            Opts::new("llmr_requests_by_tier_total", "Completed requests by tier."),
            &["tier"],
        )?;
        let request_latency = Histogram::with_opts(
            HistogramOpts::new(
                "llmr_request_duration_seconds",
                "End-to-end router request latency.",
            )
            .buckets(vec![
                0.005, 0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0,
            ]),
        )?;
        let ttft = Histogram::with_opts(
            HistogramOpts::new("llmr_ttft_seconds", "Time to first generated token.").buckets(
                vec![0.005, 0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0],
            ),
        )?;
        let queue_depth = GaugeVec::new(
            Opts::new("llmr_queue_depth", "Waiting requests per configured model."),
            &["model"],
        )?;
        registry.register(Box::new(requests.clone()))?;
        registry.register(Box::new(cache_hits.clone()))?;
        registry.register(Box::new(cache_misses.clone()))?;
        registry.register(Box::new(cache_errors.clone()))?;
        registry.register(Box::new(swaps.clone()))?;
        registry.register(Box::new(fallbacks.clone()))?;
        registry.register(Box::new(client_aborts.clone()))?;
        registry.register(Box::new(partial_offloads.clone()))?;
        registry.register(Box::new(requests_by_tier.clone()))?;
        registry.register(Box::new(request_latency.clone()))?;
        registry.register(Box::new(ttft.clone()))?;
        registry.register(Box::new(queue_depth.clone()))?;
        Ok(Self {
            registry,
            requests,
            cache_hits,
            cache_misses,
            cache_errors,
            swaps,
            fallbacks,
            client_aborts,
            partial_offloads,
            requests_by_tier,
            request_latency,
            ttft,
            queue_depth,
        })
    }

    /// Encode registry samples as Prometheus text exposition.
    pub fn encode(&self) -> Result<String, prometheus::Error> {
        let families = self.registry.gather();
        let mut buffer = Vec::new();
        TextEncoder::new().encode(&families, &mut buffer)?;
        String::from_utf8(buffer).map_err(|error| prometheus::Error::Msg(error.to_string()))
    }
}

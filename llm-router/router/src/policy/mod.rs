use crate::{
    classifier::FeatureClassifier,
    config::{AppConfig, ModelConfig},
    error::AppError,
    models::{ChatRequest, Classification, Intent, Mode, RouteDecision, Tier},
    queue::QueueManager,
};

/// Model-selection abstraction for deterministic policy tests and future policy variants.
pub trait Selector: Send + Sync {
    /// Select model, tier, fallback and human-readable reason.
    fn select(
        &self,
        request: &ChatRequest,
        classification: &Classification,
        loaded_model: Option<&str>,
    ) -> Result<RouteDecision, AppError>;
}

/// Config-driven tier selection and hardware-aware routing policy.
pub struct PolicyEngine<'a> {
    config: &'a AppConfig,
    queue: &'a QueueManager,
}
impl<'a> PolicyEngine<'a> {
    /// Bind policy to startup-validated config and shared queue state.
    pub fn new(config: &'a AppConfig, queue: &'a QueueManager) -> Self {
        Self { config, queue }
    }

    fn model_by_tier(&self, tier: &Tier) -> Option<&ModelConfig> {
        self.config
            .models
            .iter()
            .find(|model| Tier::parse(&model.tier).as_ref() == Some(tier))
    }

    fn adjacent(&self, tier: &Tier) -> Vec<Tier> {
        match tier {
            Tier::Light => vec![Tier::Code],
            Tier::Code => vec![Tier::Light, Tier::Heavy],
            Tier::Heavy => vec![Tier::Code],
        }
    }
}

impl Selector for PolicyEngine<'_> {
    fn select(
        &self,
        request: &ChatRequest,
        classification: &Classification,
        loaded_model: Option<&str>,
    ) -> Result<RouteDecision, AppError> {
        let mut selected = if request.mode == Mode::Force {
            let requested = request.model.as_deref().ok_or_else(|| {
                AppError::InvalidRequest("model is required when mode is force.".to_owned())
            })?;
            self.config
                .models
                .iter()
                .find(|model| model.name == requested)
                .ok_or(AppError::ModelNotFound)?
        } else {
            let tier = if classification.intent == Intent::Code {
                Tier::Code
            } else if classification.score < self.config.routing.light_max_score {
                Tier::Light
            } else if classification.score >= self.config.routing.heavy_min_score {
                Tier::Heavy
            } else {
                Tier::Code
            };
            self.model_by_tier(&tier).ok_or(AppError::Internal)?
        };
        let mut reason = if request.mode == Mode::Force {
            "forced model override".to_owned()
        } else if classification.intent == Intent::Code {
            "code keywords or programming syntax".to_owned()
        } else if classification.score < self.config.routing.light_max_score {
            "short, low-complexity request".to_owned()
        } else if classification.score >= self.config.routing.heavy_min_score {
            "multi-step reasoning or complex request".to_owned()
        } else {
            "moderate request complexity".to_owned()
        };

        let nearest_boundary = classification
            .score
            .abs_diff(self.config.routing.light_max_score)
            .min(
                classification
                    .score
                    .abs_diff(self.config.routing.heavy_min_score),
            );
        if request.mode != Mode::Force
            && classification.intent != Intent::Code
            && selected.name != loaded_model.unwrap_or_default()
            && nearest_boundary <= self.config.routing.warm_stickiness_margin
        {
            if let Some(warm) = loaded_model
                .and_then(|name| self.config.models.iter().find(|model| model.name == name))
            {
                selected = warm;
                reason.push_str("; kept warm model to avoid a swap");
            }
        }

        let mut tier = Tier::parse(&selected.tier).ok_or(AppError::Internal)?;
        if request.mode != Mode::Force
            && self.config.routing.queue_diversion_enabled
            && self.queue.depth(&selected.name) >= selected.max_queue
        {
            if let Some((alternative, alternative_tier)) =
                self.adjacent(&tier).into_iter().find_map(|candidate_tier| {
                    if classification.intent == Intent::Code && candidate_tier != Tier::Code {
                        return None;
                    }
                    let candidate = self.model_by_tier(&candidate_tier)?;
                    self.queue
                        .is_idle(&candidate.name)
                        .then_some((candidate, candidate_tier))
                })
            {
                selected = alternative;
                tier = alternative_tier;
                reason.push_str(
                    "; diverted to an idle adjacent tier because the target queue is full",
                );
            }
        }

        let fallback = if self.config.routing.fallback_enabled {
            selected.fallback.clone()
        } else {
            None
        };
        let queue_depth = self.queue.depth(&selected.name);
        Ok(RouteDecision {
            model: selected.name.clone(),
            tier,
            score: classification.score,
            intent: classification.intent.clone(),
            reason,
            swap_expected: loaded_model.is_some_and(|loaded| loaded != selected.name),
            fallback,
            queue_depth,
        })
    }
}

/// Convenience function for dry-run preview callers.
pub fn preview(
    config: &AppConfig,
    classifier: &FeatureClassifier,
    queue: &QueueManager,
    request: &ChatRequest,
    loaded_model: Option<&str>,
) -> Result<RouteDecision, AppError> {
    let classification = classifier.classify(request);
    PolicyEngine::new(config, queue).select(request, &classification, loaded_model)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        config::{AppConfig, ClassifierConfig, ModelConfig, RoutingConfig, ScoreWeights},
        models::{ChatOptions, Message, Role},
    };

    fn test_config() -> AppConfig {
        AppConfig {
            bind_host: "127.0.0.1".into(),
            port: 8081,
            ollama_url: "http://localhost".into(),
            redis_url: "redis://localhost".into(),
            request_timeout_ms: 1000,
            cache_enabled: false,
            cache_ttl_seconds: 60,
            cache_max_temperature: 0.2,
            models: vec![
                ModelConfig {
                    name: "small".into(),
                    tier: "light".into(),
                    max_concurrency: 1,
                    timeout_ms: 1000,
                    max_queue: 2,
                    fallback: None,
                    size_bytes: None,
                },
                ModelConfig {
                    name: "coder".into(),
                    tier: "code".into(),
                    max_concurrency: 1,
                    timeout_ms: 1000,
                    max_queue: 2,
                    fallback: None,
                    size_bytes: None,
                },
                ModelConfig {
                    name: "large".into(),
                    tier: "heavy".into(),
                    max_concurrency: 1,
                    timeout_ms: 1000,
                    max_queue: 2,
                    fallback: None,
                    size_bytes: None,
                },
            ],
            classifier: ClassifierConfig {
                weights: ScoreWeights {
                    length: 0.35,
                    reasoning: 0.30,
                    structure: 0.2,
                    context: 0.15,
                },
                simplicity_penalty: 0.25,
                reasoning_min_score: 42,
                length_saturation_tokens: 160,
                reasoning_keywords: vec!["compare".into()],
                code_keywords: vec!["python".into()],
                simple_patterns: vec!["^hi$".into()],
            },
            routing: RoutingConfig {
                light_max_score: 30,
                heavy_min_score: 65,
                warm_stickiness_margin: 8,
                max_queue_default: 6,
                queue_diversion_enabled: true,
                fallback_enabled: true,
                default_model: "small".into(),
                cache_ttl_seconds: 60,
                cache_max_temperature: 0.2,
                estimated_heavy_tokens_per_second: 20.0,
                stats_window_seconds: 300,
                recent_decisions_limit: 50,
            },
        }
    }
    fn req(prompt: &str) -> ChatRequest {
        ChatRequest {
            messages: vec![Message {
                role: Role::User,
                content: prompt.into(),
            }],
            mode: Mode::Auto,
            model: None,
            options: ChatOptions::default(),
            use_cache: false,
            request_id: None,
        }
    }
    fn classifier(config: &AppConfig) -> FeatureClassifier {
        FeatureClassifier::new(config.classifier.clone()).expect("valid test regex")
    }

    #[test]
    fn code_intent_never_sticks_to_warm_light_model() {
        let config = test_config();
        let queue = QueueManager::new(&config.models);
        let request = req("Write a Python function to sort this list");
        let decision = preview(
            &config,
            &classifier(&config),
            &queue,
            &request,
            Some("small"),
        )
        .expect("route");
        assert_eq!(decision.model, "coder");
        assert_eq!(decision.tier, Tier::Code);
    }

    #[test]
    fn force_model_wins_over_classification_and_warmth() {
        let config = test_config();
        let queue = QueueManager::new(&config.models);
        let mut request = req("hi");
        request.mode = Mode::Force;
        request.model = Some("large".into());
        let decision = preview(
            &config,
            &classifier(&config),
            &queue,
            &request,
            Some("small"),
        )
        .expect("route");
        assert_eq!(decision.model, "large");
        assert_eq!(decision.reason, "forced model override");
    }

    #[test]
    fn unknown_forced_model_fails_before_inference() {
        let config = test_config();
        let queue = QueueManager::new(&config.models);
        let mut request = req("hi");
        request.mode = Mode::Force;
        request.model = Some("not-configured".into());
        assert!(matches!(
            preview(&config, &classifier(&config), &queue, &request, None),
            Err(AppError::ModelNotFound)
        ));
    }
}

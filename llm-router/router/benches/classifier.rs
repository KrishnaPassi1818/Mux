use criterion::{black_box, criterion_group, criterion_main, Criterion};
use llm_router::{
    classifier::FeatureClassifier,
    config::{ClassifierConfig, ScoreWeights},
    models::{ChatOptions, ChatRequest, Message, Mode, Role},
};

fn classifier_benchmark(c: &mut Criterion) {
    let config = ClassifierConfig {
        weights: ScoreWeights {
            length: 0.35,
            reasoning: 0.30,
            structure: 0.20,
            context: 0.15,
        },
        simplicity_penalty: 0.25,
        reasoning_min_score: 42,
        length_saturation_tokens: 160,
        reasoning_keywords: vec!["analyze".into(), "compare".into(), "design".into()],
        code_keywords: vec!["write code".into(), "python".into()],
        simple_patterns: vec![r"^hi$".into()],
    };
    let classifier = FeatureClassifier::new(config)
        .unwrap_or_else(|error| panic!("invalid bench setup: {error}"));
    let request = ChatRequest {
        messages: vec![Message {
            role: Role::User,
            content: "analyze this prompt ".repeat(100),
        }],
        mode: Mode::Auto,
        model: None,
        options: ChatOptions::default(),
        use_cache: false,
        request_id: None,
    };
    c.bench_function("classify 2000 chars", |b| {
        b.iter(|| classifier.classify(black_box(&request)))
    });
}
criterion_group!(benches, classifier_benchmark);
criterion_main!(benches);

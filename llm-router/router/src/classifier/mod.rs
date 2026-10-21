use crate::{
    config::ClassifierConfig,
    models::{ChatRequest, Classification, Intent},
};
use regex::Regex;
use thiserror::Error;

/// Error compiling configured simplicity patterns.
#[derive(Debug, Error)]
pub enum ClassifierError {
    #[error("invalid simple_patterns regex: {0}")]
    Regex(#[from] regex::Error),
}

/// Deterministic, config-driven prompt feature extractor and scorer.
pub struct FeatureClassifier {
    config: ClassifierConfig,
    simple_patterns: Vec<Regex>,
}

impl FeatureClassifier {
    /// Compile regex patterns once at startup and validate classifier configuration.
    pub fn new(config: ClassifierConfig) -> Result<Self, ClassifierError> {
        let simple_patterns = config
            .simple_patterns
            .iter()
            .map(|pattern| Regex::new(pattern))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self {
            config,
            simple_patterns,
        })
    }

    /// Classify a request in O(prompt length) without invoking a model.
    pub fn classify(&self, request: &ChatRequest) -> Classification {
        let latest = request
            .messages
            .iter()
            .rev()
            .find(|message| matches!(message.role, crate::models::Role::User))
            .map(|message| message.content.as_str())
            .unwrap_or_default();
        let prompt = latest.to_lowercase();
        let word_count = latest.split_whitespace().count();
        let estimated_tokens = ((latest.chars().count() + 3) / 4).max(1) as u32;
        let length = normalized_ratio(
            estimated_tokens as f64,
            self.config.length_saturation_tokens.max(1) as f64,
        );

        let reasoning_hits = self
            .config
            .reasoning_keywords
            .iter()
            .filter(|keyword| contains_term(&prompt, keyword))
            .count();
        let reasoning =
            (reasoning_hits as f64 * 40.0 + if reasoning_hits > 0 { 15.0 } else { 0.0 }).min(100.0);
        let question_count = latest.matches('?').count();
        let numbered = latest
            .lines()
            .filter(|line| is_structured_line(line))
            .count();
        let structure = (question_count as f64 * 14.0
            + numbered as f64 * 20.0
            + if latest.contains('\n') { 8.0 } else { 0.0 })
        .min(100.0);
        let total_context_chars: usize = request
            .messages
            .iter()
            .map(|message| message.content.chars().count())
            .sum();
        let context = ((request.messages.len().saturating_sub(1) as f64 * 18.0)
            + total_context_chars as f64 / 60.0)
            .min(100.0);
        let single_turn = request.messages.len() == 1;
        let simple_pattern = single_turn
            && self
                .simple_patterns
                .iter()
                .any(|pattern| pattern.is_match(latest.trim()));
        let simplicity = if simple_pattern || (single_turn && word_count <= 3) {
            100.0
        } else if single_turn && word_count <= 8 && reasoning_hits == 0 {
            55.0
        } else {
            0.0
        };

        let weights = &self.config.weights;
        let raw_score = length * weights.length
            + reasoning * weights.reasoning
            + structure * weights.structure
            + context * weights.context
            - simplicity * self.config.simplicity_penalty;
        let score = raw_score.round().clamp(0.0, 100.0) as u8;
        let has_code_signal = self
            .config
            .code_keywords
            .iter()
            .any(|keyword| contains_term(&prompt, keyword))
            || latest.contains("```")
            || prompt.contains("traceback")
            || prompt.contains("stack trace");
        let intent = if has_code_signal {
            Intent::Code
        } else if reasoning_hits > 0 || score >= self.config.reasoning_min_score {
            Intent::Reasoning
        } else {
            Intent::Chat
        };
        let mut reasons = Vec::new();
        if has_code_signal {
            reasons.push("code keywords or programming syntax".to_owned());
        }
        if reasoning_hits > 0 {
            reasons.push("multi-step reasoning signals".to_owned());
        }
        if simple_pattern || (single_turn && word_count <= 3) {
            reasons.push("short factual question".to_owned());
        }
        if numbered > 0 || question_count > 1 {
            reasons.push("structured multi-part prompt".to_owned());
        }
        if request.messages.len() > 2 {
            reasons.push("multi-turn context".to_owned());
        }
        if reasons.is_empty() {
            reasons.push("general conversational request".to_owned());
        }
        Classification {
            score,
            intent,
            estimated_tokens,
            reasons,
        }
    }
}

fn normalized_ratio(value: f64, saturation: f64) -> f64 {
    (value / saturation * 100.0).clamp(0.0, 100.0)
}

fn is_structured_line(line: &str) -> bool {
    let trimmed = line.trim_start();
    if ["- ", "* ", "• "]
        .iter()
        .any(|prefix| trimmed.starts_with(prefix))
    {
        return true;
    }
    let digits = trimmed.chars().take_while(char::is_ascii_digit).count();
    if digits == 0 {
        return false;
    }
    let rest = &trimmed[digits..];
    rest.starts_with(". ") || rest.starts_with(") ")
}

fn contains_term(haystack: &str, term: &str) -> bool {
    if term.chars().any(|character| {
        character.is_whitespace() || (!character.is_alphanumeric() && character != '_')
    }) {
        haystack.contains(term)
    } else {
        haystack
            .split(|character: char| {
                !character.is_alphanumeric()
                    && character != '_'
                    && character != '+'
                    && character != '#'
            })
            .any(|candidate| candidate.eq_ignore_ascii_case(term))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{ClassifierConfig, ScoreWeights};
    use crate::models::{ChatOptions, Message, Mode, Role};

    fn classifier() -> FeatureClassifier {
        FeatureClassifier::new(ClassifierConfig {
            weights: ScoreWeights {
                length: 0.35,
                reasoning: 0.30,
                structure: 0.20,
                context: 0.15,
            },
            simplicity_penalty: 0.25,
            reasoning_min_score: 42,
            length_saturation_tokens: 160,
            reasoning_keywords: vec![
                "analyze".into(),
                "compare".into(),
                "design".into(),
                "derive".into(),
                "trade-off".into(),
                "step by step".into(),
                "evaluate".into(),
                "prove".into(),
                "reason".into(),
                "why".into(),
                "explain why".into(),
            ],
            code_keywords: vec![
                "write code".into(),
                "code snippet".into(),
                "code sample".into(),
                "function".into(),
                "debug".into(),
                "stack trace".into(),
                "traceback".into(),
                "compiler".into(),
                "refactor".into(),
                "regex".into(),
                "regular expression".into(),
                "sql".into(),
                "postgresql".into(),
                "python".into(),
                "typescript".into(),
                "javascript".into(),
                "rust".into(),
                "java".into(),
                "c++".into(),
                "bash".into(),
                "dockerfile".into(),
                "design an algorithm".into(),
                "implement an algorithm".into(),
                "exception".into(),
            ],
            simple_patterns: vec![
                r"^hi[!. ]*$".into(),
                r"^what is [^?]{1,80}\??$".into(),
                r"^define [^?]{1,80}\??$".into(),
            ],
        })
        .expect("test classifier regexes are valid")
    }

    fn request(prompt: &str) -> ChatRequest {
        ChatRequest {
            messages: vec![Message {
                role: Role::User,
                content: prompt.to_owned(),
            }],
            mode: Mode::Auto,
            model: None,
            options: ChatOptions::default(),
            use_cache: true,
            request_id: None,
        }
    }

    #[test]
    fn classifier_handles_forty_labeled_examples_and_edge_cases() {
        let classifier = classifier();
        let samples = [
            ("Hi", Intent::Chat), ("Hello!", Intent::Chat), ("Thanks", Intent::Chat), ("What is DNS?", Intent::Chat),
            ("Define gravity", Intent::Chat), ("What is a variable?", Intent::Chat), ("Translate hello to Spanish", Intent::Chat),
            ("Give me one synonym for quick", Intent::Chat), ("What time is it in UTC?", Intent::Chat), ("Name the largest ocean", Intent::Chat),
            ("What is 2 plus 2?", Intent::Chat), ("Summarize this sentence in one line", Intent::Chat), ("What does HTTP stand for?", Intent::Chat),
            ("Good morning", Intent::Chat), ("Tell me a short joke", Intent::Chat), ("What is the capital of Japan?", Intent::Chat),
            ("Explain what a list is in one sentence", Intent::Chat), ("How do I boil an egg?", Intent::Chat), ("Recommend a color for a calm room", Intent::Chat),
            ("What is photosynthesis?", Intent::Chat),
            ("Write a Python function to reverse a string", Intent::Code), ("Debug this JavaScript function", Intent::Code),
            ("Show me a SQL query that joins two tables", Intent::Code), ("Refactor this Rust method for readability", Intent::Code),
            ("Why does this Python traceback show IndexError?", Intent::Code), ("Write a regex for validating email addresses", Intent::Code),
            ("Implement binary search in Java", Intent::Code), ("Explain this stack trace and fix the null pointer", Intent::Code),
            ("Create a Dockerfile for a Node service", Intent::Code), ("What is wrong with this code? ```js const x = 1 ```", Intent::Code),
            ("Design an algorithm to find duplicate values efficiently", Intent::Code), ("How can I use an API in TypeScript?", Intent::Code),
            ("Analyze the trade-off between consistency and availability in a distributed system", Intent::Reasoning),
            ("Compare three approaches and derive the best option for these constraints", Intent::Reasoning),
            ("Design a step by step plan and evaluate its failure modes", Intent::Reasoning),
            ("Prove why this greedy algorithm is optimal and discuss its assumptions", Intent::Reasoning),
            ("Analyze the long term effects, compare alternatives, and explain why the conclusion follows", Intent::Reasoning),
            ("Reason through each edge case before recommending a robust solution", Intent::Reasoning),
            ("Evaluate two database architectures and quantify their trade-offs", Intent::Reasoning),
            ("Derive the invariant for this multi-stage process and prove it holds", Intent::Reasoning),
            ("Compare the evidence, identify uncertainty, and propose a testable hypothesis", Intent::Reasoning),
            ("Design a resilient system, analyze bottlenecks, and optimize the critical path", Intent::Reasoning),
            ("Explain why these two strategies behave differently under load", Intent::Reasoning),
            ("Break this complex decision into steps and evaluate each alternative", Intent::Reasoning),
            ("Analyze how changing three assumptions affects the final result", Intent::Reasoning),
            ("Provide a rigorous comparison, then derive a recommendation with caveats", Intent::Reasoning),
        ];
        assert!(samples.len() >= 40);
        for (prompt, expected) in samples {
            let actual = classifier.classify(&request(prompt));
            assert_eq!(
                actual.intent, expected,
                "classification mismatch for {prompt:?}: score {}",
                actual.score
            );
            assert!(actual.score <= 100);
        }
        assert_eq!(classifier.classify(&request("")).score, 0);
        assert!(
            classifier
                .classify(&request(&"unicode 🧠 ".repeat(800)))
                .estimated_tokens
                > 1000
        );
    }

    #[test]
    fn classification_is_deterministic_and_code_is_not_a_simple_override() {
        let classifier = classifier();
        let req =
            request("Write a Rust function that compares two values and returns the larger one.");
        assert_eq!(
            classifier.classify(&req).score,
            classifier.classify(&req).score
        );
        assert_eq!(classifier.classify(&req).intent, Intent::Code);
    }

    #[test]
    fn structured_context_increases_complexity() {
        let classifier = classifier();
        let short = classifier.classify(&request("hello"));
        let mut long =
            request("Compare the approaches and analyze the trade-off.\n1. Cost?\n2. Reliability?");
        long.messages.push(Message {
            role: Role::Assistant,
            content: "Which constraints matter most?".into(),
        });
        long.messages.push(Message {
            role: Role::User,
            content: "Consider deployment at global scale with gradual migration.".into(),
        });
        assert!(classifier.classify(&long).score > short.score);
    }
}

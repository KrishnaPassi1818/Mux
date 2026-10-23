#![forbid(unsafe_code)]

//! Local model routing engine library.
pub mod api;
pub mod cache;
pub mod classifier;
pub mod config;
pub mod error;
pub mod metrics;
pub mod models;
pub mod ollama;
pub mod policy;
pub mod queue;
pub mod state;

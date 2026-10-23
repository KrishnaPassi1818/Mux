mod chat;
mod handlers;

use crate::state::AppState;
use axum::{
    extract::DefaultBodyLimit,
    middleware,
    routing::{get, post},
    Router,
};
use std::sync::Arc;

/// Build the internal, contract-shaped router API.
pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(handlers::health))
        .route("/metrics", get(handlers::metrics))
        .route("/v1/models", get(handlers::models))
        .route("/v1/stats", get(handlers::stats))
        .route("/v1/cache/flush", post(handlers::flush_cache))
        .route("/v1/route/preview", post(handlers::preview))
        .route("/v1/route/chat", post(chat::chat))
        .layer(DefaultBodyLimit::max(65_536))
        .layer(middleware::from_fn(handlers::request_id_middleware))
        .with_state(Arc::new(state))
}

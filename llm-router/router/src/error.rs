use crate::models::{ErrorBody, ErrorEnvelope};
use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("invalid request: {0}")]
    InvalidRequest(String),
    #[error("model not found")]
    ModelNotFound,
    #[error("queue is full")]
    QueueFull,
    #[error("upstream request timed out")]
    UpstreamTimeout,
    #[error("upstream service unavailable")]
    UpstreamUnavailable,
    #[error("internal error")]
    Internal,
}

impl AppError {
    /// Contract error code string.
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidRequest(_) => "INVALID_REQUEST",
            Self::ModelNotFound => "MODEL_NOT_FOUND",
            Self::QueueFull => "QUEUE_FULL",
            Self::UpstreamTimeout => "UPSTREAM_TIMEOUT",
            Self::UpstreamUnavailable => "UPSTREAM_UNAVAILABLE",
            Self::Internal => "INTERNAL",
        }
    }
    /// Public message is intentionally generic for upstream/internal errors.
    pub fn public_message(&self) -> String {
        match self {
            Self::InvalidRequest(message) => message.clone(),
            Self::ModelNotFound => "Requested model is not configured.".to_owned(),
            Self::QueueFull => "The selected model queue is full. Try again shortly.".to_owned(),
            Self::UpstreamTimeout => "The selected model did not finish in time.".to_owned(),
            Self::UpstreamUnavailable => "The local model backend is unavailable.".to_owned(),
            Self::Internal => "An unexpected router error occurred.".to_owned(),
        }
    }
    /// HTTP status for a non-streaming error.
    pub fn status(&self) -> StatusCode {
        match self {
            Self::InvalidRequest(_) => StatusCode::BAD_REQUEST,
            Self::ModelNotFound => StatusCode::NOT_FOUND,
            Self::QueueFull => StatusCode::TOO_MANY_REQUESTS,
            Self::UpstreamTimeout => StatusCode::GATEWAY_TIMEOUT,
            Self::UpstreamUnavailable => StatusCode::BAD_GATEWAY,
            Self::Internal => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

/// Convert error into the contract envelope using request context.
pub fn error_response(error: AppError, request_id: Uuid) -> Response {
    if matches!(
        error,
        AppError::UpstreamUnavailable | AppError::UpstreamTimeout | AppError::Internal
    ) {
        tracing::warn!(request_id = %request_id, code = error.code(), error = %error, "router request failed");
    }
    let status = error.status();
    let body = ErrorEnvelope {
        error: ErrorBody {
            code: error.code().to_owned(),
            message: error.public_message(),
            request_id,
        },
    };
    (status, Json(body)).into_response()
}

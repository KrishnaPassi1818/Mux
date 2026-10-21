use anyhow::{Context, Result};
use llm_router::{
    api, cache, config::AppConfig, metrics::Metrics, ollama::OllamaBackend, queue::QueueManager,
    state::AppState,
};
use std::{net::SocketAddr, sync::Arc};
use tokio::net::TcpListener;
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

#[tokio::main]
async fn main() -> Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .with(tracing_subscriber::fmt::layer().json())
        .init();

    let config = AppConfig::load().context("failed to load router configuration")?;
    let cache = cache::connect(&config).await;
    let backend = OllamaBackend::new(config.ollama_url.clone(), config.request_timeout_ms)?;
    let metrics = Arc::new(Metrics::new()?);
    let queue = QueueManager::new(&config.models);
    let state = AppState::new(config.clone(), backend, cache, metrics, queue)?;
    let app = api::router(state).layer(TraceLayer::new_for_http());
    let address = SocketAddr::new(
        config.bind_host.parse().context("invalid ROUTER_HOST")?,
        config.port,
    );
    let listener = TcpListener::bind(address)
        .await
        .context("failed to bind router")?;
    tracing::info!(address = %address, "router listening");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("router server failed")?;
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(error) = tokio::signal::ctrl_c().await {
            tracing::error!(%error, "failed to install Ctrl-C handler");
        }
    };
    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(error) => tracing::error!(%error, "failed to install SIGTERM handler"),
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! { _ = ctrl_c => {}, _ = terminate => {} }
}

use crate::config::ModelConfig;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
};
use thiserror::Error;
use tokio::sync::{OwnedSemaphorePermit, RwLock, Semaphore};

#[derive(Debug, Error)]
pub enum QueueError {
    #[error("model queue is full")]
    Full,
    #[error("model queue is closed")]
    Closed,
    #[error("model is not configured")]
    UnknownModel,
}

struct ModelQueue {
    semaphore: Arc<Semaphore>,
    waiting: AtomicUsize,
    max_queue: usize,
}

/// Per-model queue and concurrency manager. `QueuePermit` releases capacity on drop/cancel.
#[derive(Clone, Default)]
pub struct QueueManager {
    queues: Arc<RwLock<HashMap<String, Arc<ModelQueue>>>>,
}

/// RAII inference permit. The underlying semaphore permit is released automatically on drop.
pub struct QueuePermit {
    _permit: OwnedSemaphorePermit,
}

struct WaitingGuard {
    waiting: Arc<ModelQueue>,
}
impl Drop for WaitingGuard {
    fn drop(&mut self) {
        self.waiting.waiting.fetch_sub(1, Ordering::AcqRel);
    }
}

impl QueueManager {
    /// Create one semaphore per configured model with a hard queue limit.
    pub fn new(models: &[ModelConfig]) -> Self {
        let queues = models
            .iter()
            .map(|model| {
                (
                    model.name.clone(),
                    Arc::new(ModelQueue {
                        semaphore: Arc::new(Semaphore::new(model.max_concurrency)),
                        waiting: AtomicUsize::new(0),
                        max_queue: model.max_queue,
                    }),
                )
            })
            .collect();
        Self {
            queues: Arc::new(RwLock::new(queues)),
        }
    }

    /// Current number of callers waiting for a model permit.
    pub fn depth(&self, model: &str) -> usize {
        self.queues
            .try_read()
            .ok()
            .and_then(|queues| {
                queues
                    .get(model)
                    .map(|queue| queue.waiting.load(Ordering::Acquire))
            })
            .unwrap_or(0)
    }

    /// Return whether at least one inference permit is immediately available.
    pub fn is_idle(&self, model: &str) -> bool {
        self.queues
            .try_read()
            .ok()
            .and_then(|queues| {
                queues
                    .get(model)
                    .map(|queue| queue.semaphore.available_permits() > 0)
            })
            .unwrap_or(false)
    }

    /// Acquire inference capacity; waiting depth is decremented even when the future is cancelled.
    pub async fn acquire(&self, model: &str) -> Result<QueuePermit, QueueError> {
        let queue = self
            .queues
            .read()
            .await
            .get(model)
            .cloned()
            .ok_or(QueueError::UnknownModel)?;
        if let Ok(permit) = Arc::clone(&queue.semaphore).try_acquire_owned() {
            return Ok(QueuePermit { _permit: permit });
        }
        let waiting = queue.waiting.fetch_add(1, Ordering::AcqRel) + 1;
        if waiting > queue.max_queue {
            queue.waiting.fetch_sub(1, Ordering::AcqRel);
            return Err(QueueError::Full);
        }
        let guard = WaitingGuard {
            waiting: Arc::clone(&queue),
        };
        let permit = Arc::clone(&queue.semaphore)
            .acquire_owned()
            .await
            .map_err(|_| QueueError::Closed)?;
        drop(guard);
        Ok(QueuePermit { _permit: permit })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::ModelConfig;

    fn model() -> ModelConfig {
        ModelConfig {
            name: "test-model".into(),
            tier: "light".into(),
            max_concurrency: 1,
            timeout_ms: 1000,
            max_queue: 1,
            fallback: None,
            size_bytes: None,
        }
    }

    #[tokio::test]
    async fn permit_is_released_when_dropped() {
        let manager = QueueManager::new(&[model()]);
        let permit = manager.acquire("test-model").await;
        assert!(permit.is_ok());
        assert!(!manager.is_idle("test-model"));
        drop(permit);
        assert!(manager.is_idle("test-model"));
    }

    #[tokio::test]
    async fn unknown_model_is_rejected() {
        let manager = QueueManager::new(&[model()]);
        assert!(matches!(
            manager.acquire("missing").await,
            Err(QueueError::UnknownModel)
        ));
    }
}

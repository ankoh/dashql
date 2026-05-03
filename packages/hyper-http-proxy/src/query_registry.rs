use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use crate::query_state::QueryState;

pub struct QueryRegistry {
    entries: RwLock<HashMap<String, Arc<QueryState>>>,
}

impl QueryRegistry {
    pub fn new() -> Self {
        Self {
            entries: RwLock::new(HashMap::new()),
        }
    }

    pub fn insert(&self, state: Arc<QueryState>) {
        self.entries
            .write()
            .unwrap()
            .insert(state.query_id.clone(), state);
    }

    pub fn get(&self, query_id: &str) -> Option<Arc<QueryState>> {
        self.entries.read().unwrap().get(query_id).cloned()
    }

    pub fn remove(&self, query_id: &str) -> Option<Arc<QueryState>> {
        self.entries.write().unwrap().remove(query_id)
    }

    /// Launches a background sweeper that removes expired entries on a
    /// `ttl / 4` cadence. Safe to call more than once but the intended
    /// use is a single startup invocation.
    pub fn spawn_sweeper(self: Arc<Self>, ttl: Duration) {
        let interval = (ttl / 4).max(Duration::from_secs(10));
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(interval).await;
                self.sweep(Instant::now());
            }
        });
    }

    fn sweep(&self, now: Instant) {
        let mut to_cancel: Vec<Arc<QueryState>> = Vec::new();
        {
            let mut entries = self.entries.write().unwrap();
            entries.retain(|_, state| {
                if state.expires_at <= now {
                    to_cancel.push(state.clone());
                    false
                } else {
                    true
                }
            });
        }
        for state in to_cancel {
            log::info!("expiring query_id={}", state.query_id);
            state.request_cancel();
        }
    }
}

impl Default for QueryRegistry {
    fn default() -> Self {
        Self::new()
    }
}

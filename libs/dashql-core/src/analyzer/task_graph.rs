use super::task::{Task, TaskStatusCode};
use serde::Serialize;
use std::default::Default;
use std::sync::RwLock;
use std::sync::RwLockReadGuard;
use std::sync::RwLockWriteGuard;
use std::{collections::HashMap, sync::Arc};

use crate::error::SystemError;
use crate::execution::task_state::TaskData;

#[derive(Debug, Clone, Serialize, Default)]
pub struct TaskGraph {
    pub instance_id: u32,
    pub next_data_id: usize,
    pub tasks: Vec<Task>,
    pub task_by_statement: Vec<usize>,
    pub state: Arc<RwLock<TaskGraphExecutionState>>,
}

impl TaskGraph {
    pub fn snapshot<'snap>(&'snap self) -> TaskGraphSnapshot<'snap> {
        TaskGraphSnapshot {
            base: self,
            global_state: self.state.read().unwrap(),
            local_state: Default::default(),
        }
    }

    pub fn try_write_global(&self) -> Result<RwLockWriteGuard<'_, TaskGraphExecutionState>, SystemError> {
        self.state
            .try_write()
            .map_err(|_| SystemError::InternalError("failed to lock global task graph execution state"))
    }
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct TaskGraphExecutionState {
    pub task_status: HashMap<usize, TaskStatusCode>,
    pub data_by_id: HashMap<usize, Arc<TaskData>>,
}

impl TaskGraphExecutionState {
    pub fn merge_into(mut self, other: &mut TaskGraphExecutionState) {
        for (k, v) in self.data_by_id.drain() {
            other.data_by_id.insert(k, v);
        }
    }
}

#[derive(Debug)]
pub struct TaskGraphSnapshot<'snap> {
    pub base: &'snap TaskGraph,
    pub global_state: RwLockReadGuard<'snap, TaskGraphExecutionState>,
    pub local_state: TaskGraphExecutionState,
}

use super::task::{Task, TaskStatusCode};
use serde::Serialize;
use std::sync::Arc;

use crate::execution::task_state::TaskData;

#[derive(Debug, Clone, Serialize)]
pub struct TaskGraph {
    pub instance_id: u32,
    pub next_data_id: usize,
    pub tasks: Vec<Task>,
    pub task_by_statement: Vec<usize>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TaskGraphExecutionState {
    pub task_status: Vec<TaskStatusCode>,
    pub data_by_id: Vec<Arc<TaskData>>,
}

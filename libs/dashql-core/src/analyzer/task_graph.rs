use super::{
    program_diff::{compute_diff, DiffOp, DiffOpCode},
    program_instance::ProgramInstance,
    task::{Task, TaskStatusCode, TaskType},
};
use serde::Serialize;
use std::sync::{atomic::AtomicU8, Arc};
use std::{collections::HashSet, sync::atomic::Ordering};

use crate::{
    error::SystemError, execution::task_state::TaskData, grammar::Statement, utils::topological_sort::TopologicalSort,
};

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

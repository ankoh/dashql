use super::task::Task;
use serde::Serialize;
use std::default::Default;

#[derive(Debug, Clone, Serialize, Default)]
pub struct TaskGraph {
    pub instance_id: u32,
    pub next_data_id: usize,
    pub tasks: Vec<Task>,
    pub task_by_statement: Vec<usize>,
}

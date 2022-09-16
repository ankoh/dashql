use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::RwLock;

use serde::Serialize;

use crate::execution::task_state::TaskData;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[repr(u8)]
pub enum TaskStatusCode {
    Pending = 0,
    Skipped = 1,
    Preparing = 2,
    Prepared = 3,
    Executing = 4,
    Blocked = 5,
    Failed = 6,
    Completed = 7,
}

impl Default for TaskStatusCode {
    fn default() -> Self {
        TaskStatusCode::Pending
    }
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize)]
pub enum TaskBlocker {
    None,
    Dependency,
    UserInteraction,
    HttpRequest,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize)]
pub enum TaskType {
    None,
    CreateTable,
    CreateViz,
    Declare,
    DropImport,
    DropInput,
    DropTable,
    DropViz,
    Import,
    Load,
    UpdateTable,
    Set,
    Unset,
    UpdateViz,
}

impl Default for TaskType {
    fn default() -> Self {
        TaskType::None
    }
}

#[derive(Debug, Serialize)]
pub struct Task {
    pub task_type: TaskType,
    #[serde(with = "crate::utils::atomic_serde::u8")]
    pub task_status: AtomicU8,
    pub depends_on: Vec<usize>,
    pub required_for: Vec<usize>,
    pub origin_statement: Option<usize>,
    pub data_id: usize,
    pub data: RwLock<Option<TaskData>>,
}

impl PartialEq for Task {
    fn eq(&self, other: &Self) -> bool {
        self.task_type == other.task_type
            && self.task_status.load(Ordering::SeqCst) == other.task_status.load(Ordering::SeqCst)
            && self.depends_on == other.depends_on
            && self.required_for == other.required_for
            && self.origin_statement == other.origin_statement
            && self.data_id == other.data_id
            && self.data.read().unwrap().eq(&other.data.read().unwrap())
    }
}

impl Eq for Task {}

impl Clone for Task {
    fn clone(&self) -> Self {
        Self {
            task_type: self.task_type.clone(),
            task_status: AtomicU8::new(self.task_status.load(Ordering::SeqCst)),
            depends_on: self.depends_on.clone(),
            required_for: self.required_for.clone(),
            origin_statement: self.origin_statement.clone(),
            data_id: self.data_id.clone(),
            data: RwLock::new(self.data.read().unwrap().clone()),
        }
    }
}

impl Default for Task {
    fn default() -> Self {
        Self {
            task_type: Default::default(),
            task_status: Default::default(),
            depends_on: Default::default(),
            required_for: Default::default(),
            origin_statement: Default::default(),
            data_id: Default::default(),
            data: Default::default(),
        }
    }
}

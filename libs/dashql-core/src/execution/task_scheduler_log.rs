use crate::{analyzer::task::TaskStatusCode, error::SystemError};

#[derive(Debug, Default)]
pub struct TaskSchedulerLogEntry {
    /// The task id
    pub task_id: usize,
    /// The task status
    pub status: TaskStatusCode,
    /// The error (if any)
    pub error: Option<SystemError>,
}

#[derive(Debug, Default)]
pub struct TaskSchedulerLog {
    /// The updates
    pub entries: Vec<TaskSchedulerLogEntry>,
    /// Any failed?
    pub any_failed: bool,
}

impl TaskSchedulerLog {
    pub fn create() -> Self {
        Self {
            entries: Vec::new(),
            any_failed: false,
        }
    }
    pub fn task_updated(&mut self, task_id: usize, status: TaskStatusCode) {
        self.entries.push(TaskSchedulerLogEntry {
            task_id,
            status,
            error: None,
        });
        self.any_failed |= status == TaskStatusCode::Failed;
    }
    pub fn task_failed(&mut self, task_id: usize, error: SystemError) {
        self.entries.push(TaskSchedulerLogEntry {
            task_id,
            status: TaskStatusCode::Failed,
            error: Some(error),
        });
        self.any_failed = true;
    }
    pub async fn flush(&mut self) {}
}

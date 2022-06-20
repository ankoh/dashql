use crate::{
    analyzer::task_planner::{TaskClass, TaskStatusCode},
    error::SystemError,
};

#[derive(Default)]
pub struct TaskSchedulerLogEntry {
    /// The task class
    pub task_class: TaskClass,
    /// The task id
    pub task_id: usize,
    /// The task status
    pub status: TaskStatusCode,
    /// The error (if any)
    pub error: Option<SystemError>,
}

pub struct TaskSchedulerLog {
    /// The updates
    updates: Vec<TaskSchedulerLogEntry>,
}

impl TaskSchedulerLog {
    pub fn change_task_status(&mut self, task_class: TaskClass, task_id: usize, status: TaskStatusCode) {
        self.updates.push(TaskSchedulerLogEntry {
            task_class,
            task_id,
            status,
            error: None,
        });
    }
    pub fn fail_task(&mut self, task_class: TaskClass, task_id: usize, error: SystemError) {
        self.updates.push(TaskSchedulerLogEntry {
            task_class,
            task_id,
            status: TaskStatusCode::Failed,
            error: Some(error),
        });
    }
    pub async fn flush(&mut self) {
        self.updates.clear();
    }
}

use std::sync::Arc;

use crate::api::workflow_api::WorkflowFrontend;
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

pub trait TaskSchedulerLog {
    fn task_updated(&mut self, task_id: usize, status: TaskStatusCode);
    fn task_failed(&mut self, task_id: usize, error: SystemError);
    fn flush(&mut self);
}

pub struct SimpleTaskSchedulerLog {
    /// The updates
    pub entries: Vec<TaskSchedulerLogEntry>,
    /// Any failed?
    pub any_failed: bool,
}

impl SimpleTaskSchedulerLog {
    pub fn create() -> Self {
        Self {
            entries: Vec::new(),
            any_failed: false,
        }
    }
}

impl TaskSchedulerLog for SimpleTaskSchedulerLog {
    fn task_updated(&mut self, task_id: usize, status: TaskStatusCode) {
        self.entries.push(TaskSchedulerLogEntry {
            task_id,
            status,
            error: None,
        });
        self.any_failed |= status == TaskStatusCode::Failed;
    }
    fn task_failed(&mut self, task_id: usize, error: SystemError) {
        self.entries.push(TaskSchedulerLogEntry {
            task_id,
            status: TaskStatusCode::Failed,
            error: Some(error),
        });
        self.any_failed = true;
    }
    fn flush(&mut self) {}
}

#[derive(Debug, Default)]
pub struct FrontendTaskSchedulerLog<WF: WorkflowFrontend> {
    /// The session id
    pub session_id: u32,
    /// The frontend
    pub frontend: Arc<WF>,
    /// The updates
    pub entries: Vec<TaskSchedulerLogEntry>,
    /// Any failed?
    pub any_failed: bool,
}

impl<WF> FrontendTaskSchedulerLog<WF>
where
    WF: WorkflowFrontend,
{
    pub fn create(session_id: u32, frontend: Arc<WF>) -> Self {
        Self {
            session_id,
            frontend,
            entries: Vec::new(),
            any_failed: false,
        }
    }
}

impl<WF> TaskSchedulerLog for FrontendTaskSchedulerLog<WF>
where
    WF: WorkflowFrontend,
{
    fn task_updated(&mut self, task_id: usize, status: TaskStatusCode) {
        self.entries.push(TaskSchedulerLogEntry {
            task_id,
            status,
            error: None,
        });
        self.any_failed |= status == TaskStatusCode::Failed;
    }
    fn task_failed(&mut self, task_id: usize, error: SystemError) {
        self.entries.push(TaskSchedulerLogEntry {
            task_id,
            status: TaskStatusCode::Failed,
            error: Some(error),
        });
        self.any_failed = true;
    }
    fn flush(&mut self) {
        for entry in self.entries.iter() {
            match self.frontend.update_task_status(
                self.session_id as u32,
                entry.task_id as u32,
                entry.status,
                entry.error.clone().map(|e| e.to_string()),
            ) {
                Ok(()) => (),
                Err(e) => {
                    // TODO log something to the console
                }
            }
        }
        self.entries.clear();
    }
}

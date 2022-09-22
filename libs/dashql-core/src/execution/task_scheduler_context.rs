use crate::api::frontend::Frontend;

use super::{execution_context::ExecutionContextSnapshot, task_scheduler_log::TaskSchedulerLog};

pub struct TaskSchedulerContext<'ast, 'snap, 'a> {
    pub exec: &'a mut ExecutionContextSnapshot<'ast, 'snap>,
    pub log: &'a mut dyn TaskSchedulerLog,
    pub frontend: &'a mut dyn Frontend,
}

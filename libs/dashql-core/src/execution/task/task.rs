use crate::error::SystemError;

use super::task_context::TaskContext;

pub trait Task {
    fn prepare(&self, ctx: &TaskContext) -> Result<(), SystemError>;
    fn will_execute(&self, ctx: &TaskContext) -> Result<(), SystemError>;
    fn execute(&self, ctx: &TaskContext) -> Result<(), SystemError>;
}

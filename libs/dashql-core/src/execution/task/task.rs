use super::task_context::TaskContext;

pub trait Task {
    fn prepare(&self, ctx: &TaskContext);
    fn will_execute(&self, ctx: &TaskContext);
    fn execute(&self, ctx: &TaskContext);
}

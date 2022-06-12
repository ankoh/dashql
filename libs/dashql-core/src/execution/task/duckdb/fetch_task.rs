use super::super::task::Task;

pub struct FetchTask {}

impl Task for FetchTask {
    fn prepare(&self, _ctx: &crate::execution::task::task_context::TaskContext) {
        todo!()
    }

    fn will_execute(&self, _ctx: &crate::execution::task::task_context::TaskContext) {
        todo!()
    }

    fn execute(&self, _ctx: &crate::execution::task::task_context::TaskContext) {
        todo!()
    }
}

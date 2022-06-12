use super::super::task::Task;

pub struct SetTask {}

impl Task for SetTask {
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

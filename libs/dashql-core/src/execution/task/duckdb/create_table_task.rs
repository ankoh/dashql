use super::super::task::Task;

pub struct CreateTableTask {}

impl Task for CreateTableTask {
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

use crate::analyzer::task::Task;
use crate::analyzer::task_graph::TaskGraph;
use crate::api::workflow_frontend::WorkflowFrontend;
use crate::execution::execution_context::ExecutionContextSnapshot;
use crate::execution::task::TaskOperator;
use crate::execution::task_state::TaskData;
use crate::external::console;
use crate::{analyzer::program_instance::ProgramInstance, error::SystemError};
use async_trait::async_trait;

pub struct DBDropTableTaskOperator<'exec> {
    task: &'exec Task,
}

impl<'exec> DBDropTableTaskOperator<'exec> {
    pub fn create<'ast>(
        _instance: &'exec ProgramInstance<'ast>,
        task_graph: &'exec TaskGraph,
        task_id: usize,
    ) -> Result<Self, SystemError> {
        Ok(Self {
            task: &task_graph.tasks[task_id],
        })
    }
}

#[async_trait(?Send)]
impl<'exec, 'ast> TaskOperator<'exec, 'ast> for DBDropTableTaskOperator<'exec> {
    async fn prepare<'snap>(
        &mut self,
        _ctx: &mut ExecutionContextSnapshot<'ast, 'snap>,
        _frontend: &WorkflowFrontend,
    ) -> Result<(), SystemError> {
        Ok(())
    }
    async fn execute<'snap>(
        &mut self,
        ctx: &mut ExecutionContextSnapshot<'ast, 'snap>,
        frontend: &WorkflowFrontend,
    ) -> Result<(), SystemError> {
        let connection = ctx.base.database_connection.as_ref();
        let data_lock = self.task.data.read().unwrap();
        let data = match data_lock.as_ref() {
            Some(data) => data,
            None => {
                console::println("DROP TABLE NOT NECESSARY");
                return Ok(());
            }
        };
        match data {
            TaskData::TableRef(t) => {
                if t.is_view {
                    connection.run_query(&format!("drop view if exists {}", t.name)).await?;
                } else {
                    connection
                        .run_query(&format!("drop table if exists {}", t.name))
                        .await?;
                }
            }
            data => {
                console::println(&format!("cannot drop {:?}", &data));
            }
        }
        frontend.delete_task_data(self.task.data_id as u32);
        Ok(())
    }
}

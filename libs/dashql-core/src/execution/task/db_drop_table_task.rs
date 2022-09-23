use crate::analyzer::task_graph::TaskGraph;
use crate::api::workflow_frontend::WorkflowFrontend;
use crate::execution::execution_context::ExecutionContextSnapshot;
use crate::execution::task::TaskOperator;
use crate::execution::task_state::TaskData;
use crate::external::console;
use crate::{analyzer::program_instance::ProgramInstance, error::SystemError};
use async_trait::async_trait;

pub struct DBDropTableTaskOperator<'exec> {
    task_graph: &'exec TaskGraph,
    task_id: usize,
}

impl<'exec> DBDropTableTaskOperator<'exec> {
    pub fn create<'ast>(
        _instance: &'exec ProgramInstance<'ast>,
        task_graph: &'exec TaskGraph,
        task_id: usize,
    ) -> Result<Self, SystemError> {
        Ok(Self {
            task_graph,
            task_id: task_id,
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
        _frontend: &WorkflowFrontend,
    ) -> Result<(), SystemError> {
        let connection = ctx.base.database_connection.as_ref();
        let data_lock = self.task_graph.tasks[self.task_id].data.read().unwrap();
        let data = match data_lock.as_ref() {
            Some(data) => data,
            None => {
                console::println("DROP TABLE NOT NECESSARY");
                return Ok(());
            }
        };
        console::println(&format!("DROP TABLE STATE {:?}", &data));
        match data {
            TaskData::TableRef(t) => {
                connection
                    .run_query(&format!("drop table if exists {}", t.name))
                    .await?;
            }
            TaskData::ViewRef(v) => {
                connection.run_query(&format!("drop view if exists {}", v.name)).await?;
            }
            data => {
                console::println(&format!("cannot drop {:?}", &data));
            }
        }
        Ok(())
    }
}

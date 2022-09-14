use std::sync::Arc;

use crate::analyzer::task_planner::TaskGraph;
use crate::execution::execution_context::ExecutionContextSnapshot;
use crate::execution::task::TaskOperator;
use crate::execution::task_state::TaskData;
use crate::external::console;
use crate::{analyzer::program_instance::ProgramInstance, error::SystemError};
use async_trait::async_trait;

pub struct DuckDBDropTableTaskOperator {
    state_id: usize,
}

impl DuckDBDropTableTaskOperator {
    pub fn create<'ast>(
        _instance: &Arc<ProgramInstance<'ast>>,
        task_graph: &Arc<TaskGraph>,
        task_id: usize,
    ) -> Result<Self, SystemError> {
        let task = &task_graph.tasks[task_id];
        Ok(Self {
            state_id: task.state_id,
        })
    }
}

#[async_trait(?Send)]
impl<'ast> TaskOperator<'ast> for DuckDBDropTableTaskOperator {
    async fn prepare<'snap>(&mut self, _ctx: &mut ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        Ok(())
    }
    async fn execute<'snap>(&mut self, ctx: &mut ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        let connection = ctx.base.database_connection.as_ref();
        console::println(&format!("DROP TABLE STATE_ID {:?}", self.state_id));
        console::println(&format!("{:?}", &ctx.global_state));
        let state = match ctx.global_state.state_by_id.get(&self.state_id) {
            Some(state) => state,
            None => return Ok(()),
        };
        console::println(&format!("DROP TABLE STATE {:?}", &state));
        match state.as_ref() {
            TaskData::TableRef(t) => {
                connection
                    .run_query(&format!("drop table if exists {}", t.name))
                    .await?;
            }
            TaskData::ViewRef(v) => {
                connection.run_query(&format!("drop view if exists {}", v.name)).await?;
            }
            state => {
                console::println(&format!("cannot drop {:?}", &state));
            }
        }
        Ok(())
    }
}

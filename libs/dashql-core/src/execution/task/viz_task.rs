use crate::analyzer::program_instance::ProgramInstance;
use crate::analyzer::task::Task;
use crate::analyzer::task_graph::TaskGraph;
use crate::api::workflow_frontend::WorkflowFrontend;
use crate::error::SystemError;
use crate::execution::execution_context::ExecutionContextSnapshot;
use crate::execution::task::TaskOperator;
use crate::execution::viz_composer::compose_viz_spec;
use crate::grammar::script_writer::print_ast_as_script_with_defaults;
use crate::grammar::{Statement, TableRef, VizStatement};
use async_trait::async_trait;
use dashql_proto::VizComponentType;
use serde_json as sj;

pub struct VegaVisTaskOperator<'exec, 'ast> {
    task: &'exec Task,
    statement: &'ast VizStatement<'ast>,
}

impl<'exec, 'ast> VegaVisTaskOperator<'exec, 'ast> {
    pub fn create(
        instance: &'exec ProgramInstance<'ast>,
        task_graph: &'exec TaskGraph,
        task_id: usize,
    ) -> Result<Self, SystemError> {
        let task = &task_graph.tasks[task_id];
        let stmt_id = task.origin_statement.unwrap();
        let stmt: &'ast VizStatement<'ast> = match instance.program.statements[stmt_id] {
            Statement::Viz(v) => v,
            _ => return Err(SystemError::InvalidStatementType("expected viz".to_string())),
        };
        Ok(Self {
            task: task,
            statement: stmt,
        })
    }
}

#[async_trait(?Send)]
impl<'exec, 'ast> TaskOperator<'exec, 'ast> for VegaVisTaskOperator<'exec, 'ast> {
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
        let extra = match self.statement.extra.get().map(|e| e.as_json(ctx)) {
            Some(Ok(sj::Value::Object(extra))) => extra,
            Some(Err(e)) => return Err(e),
            _ => sj::Map::new(),
        };
        let table_name: String = match self.statement.target.get() {
            TableRef::Relation(rel) => print_ast_as_script_with_defaults(&rel.name.get()),
            TableRef::Select(_) => {
                return Err(SystemError::NotImplemented(
                    "viz statements with embedded select clause".to_string(),
                ))
            }
            TableRef::Function(_) => {
                return Err(SystemError::NotImplemented(
                    "viz statements with embedded function call".to_string(),
                ))
            }
            TableRef::Join(_) => {
                return Err(SystemError::NotImplemented(
                    "viz statements with embedded top-level join".to_string(),
                ))
            }
        };
        let component = self.statement.component_type.get().unwrap_or(VizComponentType::TABLE);
        let spec = compose_viz_spec(ctx, table_name, component, extra).await?;
        frontend.update_visualization_data(self.task.data_id as u32, spec);
        Ok(())
    }
}

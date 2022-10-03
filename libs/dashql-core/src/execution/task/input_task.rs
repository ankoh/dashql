use std::sync::Arc;

use crate::analyzer::input_spec::{InputRendererData, InputSpec, InputTextRendererData};
use crate::analyzer::task::Task;
use crate::analyzer::task_graph::TaskGraph;
use crate::api::workflow_frontend::WorkflowFrontend;
use crate::execution::execution_context::ExecutionContextSnapshot;
use crate::execution::task::TaskOperator;
use crate::execution::task_state::{InputData, TaskData};
use crate::grammar::{DeclareStatement, Statement};
use crate::{analyzer::program_instance::ProgramInstance, error::SystemError};
use async_trait::async_trait;
use dashql_proto::InputComponentType;
use serde_json as sj;

pub struct InputTaskOperator<'exec, 'ast> {
    _instance: &'exec ProgramInstance<'ast>,
    _task_graph: &'exec TaskGraph,
    task: &'exec Task,
    statement: &'ast DeclareStatement<'ast>,
}

impl<'exec, 'ast> InputTaskOperator<'exec, 'ast> {
    pub fn create(
        instance: &'exec ProgramInstance<'ast>,
        task_graph: &'exec TaskGraph,
        task_id: usize,
    ) -> Result<Self, SystemError> {
        let task = &task_graph.tasks[task_id];
        let stmt_id = task.origin_statement.unwrap();
        let stmt: &'ast DeclareStatement<'ast> = match instance.program.statements[stmt_id] {
            Statement::Declare(v) => v,
            _ => return Err(SystemError::InvalidStatementType("expected input".to_string())),
        };
        Ok(Self {
            _instance: instance.clone(),
            _task_graph: task_graph,
            task: task,
            statement: stmt,
        })
    }
}

#[async_trait(?Send)]
impl<'exec, 'ast> TaskOperator<'exec, 'ast> for InputTaskOperator<'exec, 'ast> {
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
        let _extra = match self.statement.extra.get().map(|e| e.as_json(ctx)) {
            Some(Ok(sj::Value::Object(extra))) => extra,
            Some(Err(e)) => return Err(e),
            _ => sj::Map::new(),
        };
        let _component = self.statement.component_type.get().unwrap_or(InputComponentType::TEXT);
        let spec = Arc::new(InputSpec {
            value_type: arrow::datatypes::DataType::Null,
            renderer: InputRendererData::Text(InputTextRendererData {
                placeholder: Default::default(),
            }),
        });
        *self.task.data.write().unwrap() = Some(TaskData::InputData(InputData { spec: spec.clone() }));
        frontend.update_input_data(self.task.data_id as u32, spec);
        Ok(())
    }
}

use std::rc::Rc;
use std::sync::Arc;

use crate::analyzer::input_spec::{InputRendererData, InputSpec, InputTextRendererData};
use crate::analyzer::task::Task;
use crate::analyzer::task_graph::TaskGraph;
use crate::api::workflow_frontend::WorkflowFrontend;
use crate::execution::execution_context::ExecutionContextSnapshot;
use crate::execution::scalar_value::ScalarValue;
use crate::execution::task::TaskOperator;
use crate::execution::task_state::{InputData, TaskData};
use crate::grammar::{DeclareStatement, SQLBaseType, Statement};
use crate::{analyzer::program_instance::ProgramInstance, error::SystemError};
use arrow::datatypes::DataType;
use async_trait::async_trait;
use dashql_proto::InputComponentType;
use serde_json as sj;

pub struct InputTaskOperator<'exec, 'ast> {
    instance: &'exec ProgramInstance<'ast>,
    _task_graph: &'exec TaskGraph,
    task: &'exec Task,
    statement_id: usize,
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
            instance: instance.clone(),
            _task_graph: task_graph,
            task: task,
            statement_id: stmt_id,
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
        // Render the input component
        let _extra = match self.statement.extra.get().map(|e| e.as_json(ctx)) {
            Some(Ok(sj::Value::Object(extra))) => extra,
            Some(Err(e)) => return Err(e),
            _ => sj::Map::new(),
        };
        let _component = self.statement.component_type.get().unwrap_or(InputComponentType::TEXT);

        let value_type = match self.statement.value_type.get().base_type.get() {
            SQLBaseType::Invalid => DataType::Null,
            SQLBaseType::Generic(_) => DataType::Null,
            SQLBaseType::Numeric(num) => match num.base.get() {
                dashql_proto::NumericType::BOOL => DataType::Boolean,
                dashql_proto::NumericType::FLOAT4 => DataType::Float32,
                dashql_proto::NumericType::FLOAT8 => DataType::Float64,
                dashql_proto::NumericType::INT1 => DataType::Int8,
                dashql_proto::NumericType::INT2 => DataType::Int16,
                dashql_proto::NumericType::INT4 => DataType::Int32,
                dashql_proto::NumericType::INT8 => DataType::Int64,
                dashql_proto::NumericType::NUMERIC => DataType::Float64, // XXX
                _ => DataType::Float64,
            },
            SQLBaseType::Bit(_) => DataType::Utf8,
            SQLBaseType::Character(_) => DataType::Utf8,
            SQLBaseType::Time(_) => DataType::Utf8,      // XXX
            SQLBaseType::Timestamp(_) => DataType::Utf8, // XXX
            SQLBaseType::Interval(_) => DataType::Utf8,  // XXX
        };
        let spec = Arc::new(InputSpec {
            value_type: value_type.clone(),
            default_value: None,
            renderer: InputRendererData::Text(InputTextRendererData {
                placeholder: match value_type {
                    DataType::Null => "Null",
                    DataType::Boolean => "Boolean",
                    DataType::Int8
                    | DataType::Int16
                    | DataType::Int32
                    | DataType::Int64
                    | DataType::UInt8
                    | DataType::UInt16
                    | DataType::UInt32
                    | DataType::UInt64 => "Number",
                    DataType::Float16 | DataType::Float32 | DataType::Float64 => "Number",
                    DataType::Timestamp(_, _) => "Timestamp",
                    DataType::Date32 | DataType::Date64 => "Date",
                    DataType::Time32(_) | DataType::Time64(_) => "Time",
                    DataType::Duration(_) => "Duration",
                    DataType::Interval(_) => "Interval",
                    DataType::Utf8 | DataType::LargeUtf8 => "Text",
                    DataType::List(_) => "List",
                    DataType::Struct(_) => "Struct",
                    DataType::Decimal(_, _) => "Decimal",
                    _ => "",
                }
                .to_string(),
            }),
        });
        *self.task.data.write().unwrap() = Some(TaskData::InputData(InputData { spec: spec.clone() }));
        frontend.update_input_data(self.task.data_id as u32, spec);

        // Update parameter in state
        let name = self.statement.name.get();
        if let Some(value) = self.instance.parameters.get(&self.statement_id) {
            ctx.local_state.parameters.insert(name, value.clone());
        } else {
            let value = match value_type {
                DataType::Null => None,
                DataType::Boolean => Some(ScalarValue::Boolean(false)),
                DataType::Int8
                | DataType::Int16
                | DataType::Int32
                | DataType::Int64
                | DataType::UInt8
                | DataType::UInt16
                | DataType::UInt32
                | DataType::UInt64 => Some(ScalarValue::Int64(0)),
                DataType::Float16 | DataType::Float32 | DataType::Float64 => Some(ScalarValue::Float64(0.0)),
                DataType::Utf8 | DataType::LargeUtf8 => Some(ScalarValue::Utf8("".to_string())),
                _ => None,
            };
            let value = value.map(|v| Rc::new(v));
            ctx.local_state.parameters.insert(name, value);
        };
        Ok(())
    }
}

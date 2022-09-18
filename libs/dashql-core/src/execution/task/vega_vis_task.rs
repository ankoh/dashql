use std::sync::Arc;

use crate::analyzer::program_instance::ProgramInstance;
use crate::analyzer::task_graph::TaskGraph;
use crate::error::SystemError;
use crate::execution::execution_context::ExecutionContextSnapshot;
use crate::execution::task::TaskOperator;
use crate::external::console;
use crate::grammar::{Statement, VizStatement};
use async_trait::async_trait;
use dashql_proto::VizComponentType;

pub struct VegaVisTaskOperator<'ast> {
    statement: &'ast VizStatement<'ast>,
}

impl<'ast> VegaVisTaskOperator<'ast> {
    pub fn create(
        instance: &Arc<ProgramInstance<'ast>>,
        task_graph: &Arc<TaskGraph>,
        task_id: usize,
    ) -> Result<Self, SystemError> {
        let task = &task_graph.tasks[task_id];
        let stmt_id = task.origin_statement.unwrap();
        let stmt: &'ast VizStatement<'ast> = match instance.program.statements[stmt_id] {
            Statement::Viz(v) => v,
            _ => return Err(SystemError::InvalidStatementType("expected viz".to_string())),
        };
        Ok(Self { statement: stmt })
    }
}

#[async_trait(?Send)]
impl<'ast> TaskOperator<'ast> for VegaVisTaskOperator<'ast> {
    async fn prepare<'snap>(&mut self, _ctx: &mut ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        Ok(())
    }
    async fn execute<'snap>(&mut self, ctx: &mut ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        let extra = match self.statement.extra.get() {
            Some(extra) => extra.as_json(ctx),
            None => Ok(serde_json::Value::Object(serde_json::Map::new())),
        }?;
        console::println(&format!("{}", extra.to_string()));

        if let Some(component_type) = self.statement.component_type.get() {
            let mut columns = Vec::new();
            let mut required = Vec::new();
            match component_type {
                VizComponentType::TABLE => (),
                VizComponentType::HEX => (),
                VizComponentType::JSON => (),

                VizComponentType::SPEC => (),

                VizComponentType::AREA | VizComponentType::BAR => {
                    columns.extend_from_slice(&["x", "x2", "y", "y2", "color", "shape", "size"]);
                    required.extend_from_slice(&["x", "y"]);
                }
                VizComponentType::LINE | VizComponentType::SCATTER | VizComponentType::BOX => {
                    columns.extend_from_slice(&["x", "y", "color", "shape", "size"]);
                    required.extend_from_slice(&["x", "y"]);
                }
                VizComponentType::PIE => {
                    columns.extend_from_slice(&["theta", "radius", "shape", "size"]);
                    required.extend_from_slice(&["theta", "radius"]);
                }

                _ => {
                    return Err(SystemError::NotImplemented(
                        "visualization component type is not implemented".to_string(),
                    ))
                }
            }
        } else {
        }
        Ok(())
    }
}

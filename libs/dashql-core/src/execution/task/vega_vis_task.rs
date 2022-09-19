use std::sync::Arc;

use crate::analyzer::program_instance::ProgramInstance;
use crate::analyzer::task_graph::TaskGraph;
use crate::analyzer::viz_spec::{HexRenderer, JsonRenderer, TableRenderer, VegaLiteRenderer, VizRenderer, VizSpec};
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
        let mut out = VizSpec::default();
        console::println(&format!("{}", extra.to_string()));

        if let Some(component_type) = self.statement.component_type.get() {
            let mut encodings = Vec::new();
            let mut required_encodings = Vec::new();
            encodings.reserve(8);
            required_encodings.reserve(8);
            match component_type {
                VizComponentType::TABLE => {
                    out.renderer = VizRenderer::Table(TableRenderer {
                        table_name: "".to_string(),
                        row_count: None,
                    });
                }
                VizComponentType::HEX => {
                    out.renderer = VizRenderer::Hex(HexRenderer { source_data_id: 0 });
                }
                VizComponentType::JSON => {
                    out.renderer = VizRenderer::Json(JsonRenderer { source_data_id: 0 });
                }
                VizComponentType::SPEC => {
                    out.renderer = VizRenderer::VegaLite(VegaLiteRenderer {
                        table_name: "".to_string(),
                        sampling: None,
                    });
                }
                VizComponentType::AREA | VizComponentType::BAR => {
                    encodings.extend_from_slice(&["x", "x2", "y", "y2", "color", "shape", "size"]);
                    required_encodings.extend_from_slice(&["x", "y"]);
                }
                VizComponentType::LINE | VizComponentType::SCATTER => {
                    encodings.extend_from_slice(&["x", "y", "color", "shape", "size"]);
                    required_encodings.extend_from_slice(&["x", "y"]);
                }
                VizComponentType::PIE => {
                    encodings.extend_from_slice(&["theta", "radius", "shape", "size"]);
                    required_encodings.extend_from_slice(&["theta", "radius"]);
                }
                _ => {
                    return Err(SystemError::NotImplemented(
                        "visualization component type is not implemented".to_string(),
                    ))
                }
            }
            let _mark = match component_type {
                VizComponentType::AREA => "area",
                VizComponentType::BAR => "bar",
                VizComponentType::SCATTER => "point",
                VizComponentType::LINE => "line",
                VizComponentType::PIE => "arc",
                _ => "",
            };
        } else {
        }
        Ok(())
    }
}

use std::sync::Arc;

use crate::analyzer::program_instance::ProgramInstance;
use crate::analyzer::task_graph::TaskGraph;
use crate::analyzer::viz_spec::{HexRenderer, JsonRenderer, TableRenderer, VizRenderer, VizSpec};
use crate::error::SystemError;
use crate::execution::execution_context::ExecutionContextSnapshot;
use crate::execution::task::TaskOperator;
use crate::external::console;
use crate::grammar::{Statement, VizStatement};
use async_trait::async_trait;
use dashql_proto::VizComponentType;
use serde_json as sj;

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
        let extra = match self.statement.extra.get().map(|e| e.as_json(ctx)) {
            Some(Ok(sj::Value::Object(extra))) => extra,
            Some(Err(e)) => return Err(e),
            _ => sj::Map::new(),
        };
        let extra_encoding = match extra.get("encoding") {
            Some(sj::Value::Object(enc)) => enc.clone(),
            _ => sj::Map::new(),
        };
        let mut out = VizSpec::default();
        console::println(&format!("{:?}", extra));

        let resolve_inner_encoding = |root: &sj::Map<String, sj::Value>, column_names: &[String], name: &str| {
            if let Some(field) = root.get(name) {
                match field {
                    sj::Value::Null => return Ok(None),
                    sj::Value::Bool(_) | sj::Value::Array(_) => {
                        return Err(SystemError::InvalidSpecification(format!(
                            "invalid encoding: {}",
                            field,
                        )));
                    }
                    sj::Value::Number(idx) => {
                        let idx = idx.as_f64().unwrap_or_default() as usize;
                        if idx > column_names.len() {
                            return Err(SystemError::InvalidSpecification(format!(
                                "column index out of bounds: {}/{}",
                                idx,
                                column_names.len(),
                            )));
                        }
                        let mut map = sj::Map::new();
                        map.insert("field".to_string(), sj::Value::String(column_names[idx].clone()));
                        return Ok(Some(map));
                    }
                    sj::Value::String(field) => {
                        let mut map = sj::Map::new();
                        map.insert("field".to_string(), sj::Value::String(field.clone()));
                        return Ok(Some(map));
                    }
                    sj::Value::Object(o) => {
                        return Ok(Some(o.clone()));
                    }
                }
            }
            return Ok(None);
        };
        let resolve_encoding =
            |column_names: &[String], name: &str| -> Result<Option<sj::Map<String, sj::Value>>, SystemError> {
                if let Some(field) = resolve_inner_encoding(&extra, column_names, name)? {
                    return Ok(Some(field));
                }
                if let Some(field) = resolve_inner_encoding(&extra_encoding, column_names, name)? {
                    return Ok(Some(field));
                }
                Ok(None)
            };

        let mut vl: sj::Map<String, sj::Value> = sj::Map::new();
        let mut vl_encoding: sj::Map<String, sj::Value> = sj::Map::new();
        let mut column_names = Vec::new();

        if let Some(component_type) = self.statement.component_type.get() {
            let mut required_encodings = Vec::new();
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
                VizComponentType::SPEC => {}
                VizComponentType::AREA | VizComponentType::BAR => {
                    for field in &["x", "x2", "y", "y2", "color", "shape", "size"] {
                        if let Some(enc) = resolve_encoding(&column_names, field)? {
                            vl_encoding.insert(field.to_string(), sj::Value::Object(enc));
                        }
                    }
                    required_encodings.extend_from_slice(&["x", "y"]);
                }
                VizComponentType::LINE | VizComponentType::SCATTER => {
                    for field in &["x", "y", "color", "shape", "size"] {
                        if let Some(enc) = resolve_encoding(&column_names, field)? {
                            vl_encoding.insert(field.to_string(), sj::Value::Object(enc));
                        }
                    }
                    required_encodings.extend_from_slice(&["x", "y"]);
                }
                VizComponentType::PIE => {
                    for field in &["theta", "radius", "shape", "size"] {
                        if let Some(enc) = resolve_encoding(&column_names, field)? {
                            vl_encoding.insert(field.to_string(), sj::Value::Object(enc));
                        }
                    }
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

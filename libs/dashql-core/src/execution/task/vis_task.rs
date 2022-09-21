use std::sync::Arc;

use crate::analyzer::program_instance::ProgramInstance;
use crate::analyzer::task_graph::TaskGraph;
use crate::analyzer::viz_spec::{HexRenderer, JsonRenderer, TableRenderer, VegaLiteRenderer, VizRenderer, VizSpec};
use crate::error::SystemError;
use crate::execution::execution_context::ExecutionContextSnapshot;
use crate::execution::table_metadata::{resolve_table_metadata, TableMetadata};
use crate::execution::task::TaskOperator;
use crate::external::console;
use crate::grammar::script_writer::print_ast_as_script_with_defaults;
use crate::grammar::{Statement, TableRef, VizStatement};
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
        let table_metadata = resolve_table_metadata(ctx, &table_name).await?;
        let mut assigned_columns: Vec<bool> = Vec::new();
        assigned_columns.resize(table_metadata.column_names.len(), false);

        let resolve_inner_encoding =
            |root: &sj::Map<String, sj::Value>, table: &TableMetadata, name: &str, assigned: &mut Vec<bool>| {
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
                            if idx > table.column_names.len() {
                                return Err(SystemError::InvalidSpecification(format!(
                                    "column index out of bounds: {}/{}",
                                    idx,
                                    table.column_names.len(),
                                )));
                            }
                            let mut map = sj::Map::new();
                            map.insert("field".to_string(), sj::Value::String(table.column_names[idx].clone()));
                            assigned[idx] = true;
                            return Ok(Some(map));
                        }
                        sj::Value::String(field) => {
                            let mut map = sj::Map::new();
                            map.insert("field".to_string(), sj::Value::String(field.clone()));
                            if let Some(idx) = table.column_name_mapping.get(field) {
                                assigned[*idx] = true;
                            }
                            return Ok(Some(map));
                        }
                        sj::Value::Object(o) => {
                            return Ok(Some(o.clone()));
                        }
                    }
                }
                return Ok(None);
            };
        let resolve_encoding = |table: &TableMetadata,
                                name: &str,
                                assigned: &mut Vec<bool>|
         -> Result<Option<sj::Map<String, sj::Value>>, SystemError> {
            if let Some(field) = resolve_inner_encoding(&extra, table, name, assigned)? {
                return Ok(Some(field));
            }
            if let Some(field) = resolve_inner_encoding(&extra_encoding, table, name, assigned)? {
                return Ok(Some(field));
            }
            Ok(None)
        };

        if let Some(component_type) = self.statement.component_type.get() {
            let mut required_encodings = Vec::new();
            required_encodings.reserve(8);
            match component_type {
                VizComponentType::TABLE => {
                    out.renderer = VizRenderer::Table(TableRenderer {
                        table_name: table_name.clone(),
                        row_count: table_metadata.row_count.map(|c| c as u32),
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
                        table_name: table_name.clone(),
                        sampling: None,
                        spec: extra.clone(),
                    })
                }
                VizComponentType::AREA
                | VizComponentType::BAR
                | VizComponentType::LINE
                | VizComponentType::SCATTER
                | VizComponentType::PIE => {
                    let _vl: sj::Map<String, sj::Value> = sj::Map::new();
                    let mut vl_encoding: sj::Map<String, sj::Value> = sj::Map::new();

                    let _mark = match component_type {
                        VizComponentType::AREA => "area",
                        VizComponentType::BAR => "bar",
                        VizComponentType::LINE => "line",
                        VizComponentType::PIE => "arc",
                        VizComponentType::SCATTER => "point",
                        _ => "",
                    };
                    match component_type {
                        VizComponentType::AREA | VizComponentType::BAR => {
                            for field in &["x", "x2", "y", "y2", "color", "shape", "size"] {
                                if let Some(enc) = resolve_encoding(&table_metadata, field, &mut assigned_columns)? {
                                    vl_encoding.insert(field.to_string(), sj::Value::Object(enc));
                                }
                            }
                            required_encodings.extend_from_slice(&["x", "y"]);
                        }
                        VizComponentType::LINE | VizComponentType::SCATTER => {
                            for field in &["x", "y", "color", "shape", "size"] {
                                if let Some(enc) = resolve_encoding(&table_metadata, field, &mut assigned_columns)? {
                                    vl_encoding.insert(field.to_string(), sj::Value::Object(enc));
                                }
                            }
                            required_encodings.extend_from_slice(&["x", "y"]);
                        }
                        VizComponentType::PIE => {
                            for field in &["theta", "radius", "shape", "size"] {
                                if let Some(enc) = resolve_encoding(&table_metadata, field, &mut assigned_columns)? {
                                    vl_encoding.insert(field.to_string(), sj::Value::Object(enc));
                                }
                            }
                            required_encodings.extend_from_slice(&["theta", "radius"]);
                        }
                        _ => {}
                    }
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

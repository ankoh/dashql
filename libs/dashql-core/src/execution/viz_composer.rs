use std::sync::Arc;

use dashql_proto::VizComponentType;
use serde_json as sj;

use crate::{
    analyzer::viz_spec::{HexRenderer, JsonRenderer, TableRenderer, VegaLiteRenderer, VizRenderer, VizSpec},
    error::SystemError,
    external::console,
};

use super::{
    execution_context::ExecutionContextSnapshot,
    table_metadata::{resolve_table_metadata, TableMetadata},
};

pub(crate) async fn compose_viz_spec<'ast, 'snap>(
    ctx: &mut ExecutionContextSnapshot<'ast, 'snap>,
    target: String,
    component: VizComponentType,
    extra: sj::Map<String, sj::Value>,
) -> Result<Arc<VizSpec>, SystemError> {
    let extra_encoding = match extra.get("encoding") {
        Some(sj::Value::Object(enc)) => enc.clone(),
        _ => sj::Map::new(),
    };
    let mut out = VizSpec::default();
    console::println(&format!("{:?}", extra));

    let table_metadata = resolve_table_metadata(ctx, &target).await?;
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

    let mut required_encodings = Vec::new();
    required_encodings.reserve(8);
    match component {
        VizComponentType::TABLE => {
            out.renderer = VizRenderer::Table(TableRenderer {
                table_name: target.clone(),
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
                table_name: target.clone(),
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

            let _mark = match component {
                VizComponentType::AREA => "area",
                VizComponentType::BAR => "bar",
                VizComponentType::LINE => "line",
                VizComponentType::PIE => "arc",
                VizComponentType::SCATTER => "point",
                _ => "",
            };
            match component {
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
    Ok(Arc::new(out))
}

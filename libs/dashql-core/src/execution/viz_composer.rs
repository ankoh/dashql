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
                row_count: table_metadata.row_count as u32,
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

#[cfg(test)]
mod test {
    use arrow::datatypes::DataType;
    use serde_json::json;

    use crate::{
        analyzer::{
            program_instance::analyze_program,
            task::TaskStatusCode,
            task_planner::plan_tasks,
            viz_spec::{TableRenderer, VegaLiteRenderer, VizRenderer, VizSpec},
        },
        api::workflow_frontend::{run_task_status_updates, WorkflowFrontend},
        execution::{
            execution_context::ExecutionContext,
            table_metadata::TableMetadata,
            task_scheduler::TaskScheduler,
            task_state::{TableRef, TaskData, VizData},
        },
        grammar::ProgramContainer,
    };
    use std::{collections::HashMap, error::Error, sync::Arc};

    fn unpack_object(v: serde_json::Value) -> serde_json::Map<String, serde_json::Value> {
        match v {
            serde_json::Value::Object(m) => m,
            _ => serde_json::Map::new(),
        }
    }

    async fn test_data(script: &'static str, data: Vec<TaskData>) -> Result<(), Box<dyn Error + Send + Sync>> {
        // Plan the program
        let program = ProgramContainer::parse(&script).await?;
        let context = ExecutionContext::create_simple(program.get_arena()).await?;
        let instance = analyze_program(context, script, program.get_program().clone(), HashMap::new())?;
        let task_graph = plan_tasks(&instance, None)?;

        // Run the scheduler
        let mut task_scheduler = TaskScheduler::schedule(&instance, &task_graph)?;
        let mut frontend = WorkflowFrontend::default();
        loop {
            let work_left = task_scheduler.next(&mut frontend).await?;
            if !work_left {
                break;
            }
        }
        let updates = frontend.flush_updates_manually();
        let task_status = run_task_status_updates(&updates);
        let failed: Vec<_> = task_status
            .iter()
            .filter(|(status, _)| *status == TaskStatusCode::Failed)
            .collect();
        assert!(failed.is_empty(), "{:?}", failed);

        // Test task data
        for (task_id, task_data) in data.iter().enumerate() {
            assert!(task_id < task_graph.tasks.len(), "[{}] {:?}", task_id, task_graph.tasks);
            let data = task_graph.tasks[task_id].data.read().unwrap();
            assert_eq!(data.as_ref().unwrap(), task_data);
        }
        Ok(())
    }

    #[tokio::test]
    async fn test_viz_1() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_data(
            r#"
        create table foo as select 42 as a;
        visualize foo using table;
            "#,
            vec![
                TaskData::TableRef(TableRef {
                    name: "foo".to_string(),
                    metadata: Arc::new(TableMetadata {
                        column_names: vec!["a".to_string()],
                        column_types: vec![DataType::Int32],
                        column_name_mapping: HashMap::from([("a".to_string(), 0)]),
                        row_count: 1,
                    }),
                }),
                TaskData::VizData(VizData {
                    spec: Arc::new(VizSpec {
                        renderer: VizRenderer::Table(TableRenderer {
                            table_name: "foo".to_string(),
                            row_count: 1,
                        }),
                    }),
                }),
            ],
        )
        .await?;
        Ok(())
    }

    #[tokio::test]
    async fn test_viz_2() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_data(
            r#"
        create table foo as select 42 as a;
        visualize foo using (
            title = 'Covid Total Doses',
            position = (row = 0, column = 0, width = 12, height = 4),
            mark = 'area',
            encoding = (
                x = (
                    title = 'Time',
                    field = 'date',
                    type = 'temporal',
                ),
                y = (
                    title = 'Doses',
                    field = 'dosen_kumulativ',
                    type = 'quantitative',
                ),
            )
        );
            "#,
            vec![
                TaskData::TableRef(TableRef {
                    name: "foo".to_string(),
                    metadata: Arc::new(TableMetadata {
                        column_names: vec!["a".to_string()],
                        column_types: vec![DataType::Int32],
                        column_name_mapping: HashMap::from([("a".to_string(), 0)]),
                        row_count: 1,
                    }),
                }),
                TaskData::VizData(VizData {
                    spec: Arc::new(VizSpec {
                        renderer: VizRenderer::VegaLite(VegaLiteRenderer {
                            table_name: "foo".to_string(),
                            sampling: None,
                            spec: unpack_object(json!({
                                "position": {
                                    "row": "0",
                                    "column": "0",
                                    "width": "12",
                                    "height": "4",
                                },
                                "title": "Covid Total Doses",
                                "encoding": {
                                    "x": {
                                        "title": "Time",
                                        "field": "date",
                                        "type": "temporal",
                                    },
                                    "y": {
                                        "title": "Doses",
                                        "field": "dosen_kumulativ",
                                        "type": "quantitative",
                                    }
                                },
                                "mark": "area"
                            })),
                        }),
                    }),
                }),
            ],
        )
        .await?;
        Ok(())
    }
}

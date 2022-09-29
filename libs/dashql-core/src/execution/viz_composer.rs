use std::{collections::HashSet, sync::Arc};

use arrow::datatypes::DataType;
use dashql_proto::{VizComponentType, VizComponentTypeModifier};
use serde_json::{self as sj, json};

use crate::{
    analyzer::viz_spec::{
        HexRendererData, JsonRendererData, TableRendererData, VegaLiteRendererData, VizRendererData, VizSpec,
    },
    error::SystemError,
};

use super::{execution_context::ExecutionContextSnapshot, table_metadata::TableMetadata, task_state::TaskData};

enum VLFieldType {
    QUANTITATIVE,
    NOMINAL,
    TEMPORAL,
}

pub(crate) async fn compose_viz_spec<'ast, 'snap>(
    ctx: &mut ExecutionContextSnapshot<'ast, 'snap>,
    data: &TaskData,
    component: VizComponentType,
    modifiers: &HashSet<VizComponentTypeModifier>,
    extra: sj::Map<String, sj::Value>,
) -> Result<Arc<VizSpec>, SystemError> {
    let mut out = VizSpec::default();
    out.renderer = match component {
        VizComponentType::TABLE => {
            let table = assume_data_is_table(data)?;
            VizRendererData::Table(TableRendererData { table: table.clone() })
        }
        VizComponentType::HEX => VizRendererData::Hex(HexRendererData { source_data_id: 0 }),
        VizComponentType::JSON => VizRendererData::Json(JsonRendererData { source_data_id: 0 }),
        VizComponentType::SPEC => {
            let table = assume_data_is_table(data)?;
            let mut vl = extra.clone();
            vl.remove(&"position".to_string());
            vl.remove(&"title".to_string());
            VizRendererData::VegaLite(optimize_vl_spec(ctx, &table, component, modifiers, vl).await?)
        }
        VizComponentType::AREA
        | VizComponentType::BAR
        | VizComponentType::LINE
        | VizComponentType::SCATTER
        | VizComponentType::PIE => {
            let table = assume_data_is_table(data)?;
            let vl = generate_vl_spec(ctx, data, component, modifiers, extra).await?;
            VizRendererData::VegaLite(optimize_vl_spec(ctx, &table, component, modifiers, vl).await?)
        }
        _ => {
            return Err(SystemError::NotImplemented(
                "visualization component type is not implemented".to_string(),
            ))
        }
    };
    Ok(Arc::new(out))
}

async fn optimize_vl_spec<'ast, 'snap>(
    _ctx: &mut ExecutionContextSnapshot<'ast, 'snap>,
    table: &Arc<TableMetadata>,
    component: VizComponentType,
    modifiers: &HashSet<VizComponentTypeModifier>,
    spec: sj::Map<String, sj::Value>,
) -> Result<VegaLiteRendererData, SystemError> {
    let mut tmp = sj::Map::new();
    let field_key = "field".to_string();

    // Check all encodings
    let encodings = match spec.get("encoding") {
        Some(sj::Value::Object(ref enc)) => enc,
        _ => &mut tmp,
    };
    for (key, value) in encodings.iter() {
        // Unpack encoding object
        let encoding = match value {
            sj::Value::Object(fields) => fields,
            _ => continue,
        };
        // Is field def?
        let field = if let Some(sj::Value::String(value)) = encoding.get(&field_key) {
            value
        } else {
            // TODO warning
            continue;
        };
        // Refers to a column name?
        // Will likely throw a database error later if not known here...
        let column_id = if let Some(column_id) = table.column_name_mapping.get(field) {
            *column_id
        } else {
            // TODO warning
            continue;
        };
        // Resolve vega-lite field type
        let column_type = &table.column_types[column_id];
        let field_type = match column_type {
            DataType::Boolean
            | DataType::Int8
            | DataType::Int16
            | DataType::Int32
            | DataType::Int64
            | DataType::UInt8
            | DataType::UInt16
            | DataType::UInt32
            | DataType::UInt64
            | DataType::Float16
            | DataType::Float32
            | DataType::Float64 => VLFieldType::QUANTITATIVE,
            DataType::Utf8 | DataType::LargeUtf8 => VLFieldType::NOMINAL,
            DataType::Timestamp(_, _)
            | DataType::Date32
            | DataType::Date64
            | DataType::Time32(_)
            | DataType::Time64(_)
            | DataType::Duration(_)
            | DataType::Interval(_) => VLFieldType::TEMPORAL,
            _ => continue,
        };
    }

    let spec = spec;

    Ok(VegaLiteRendererData {
        table: table.clone(),
        sampling: None,
        spec: json!({
            "autosize": {
                "type": "fit",
                "contains": "padding",
                "resize": true,
            },
            "background": "transparent",
            "padding": 8,
            "width": "container",
            "height": "container",
            "layer": [
                spec
            ],
        }),
    })
}

async fn generate_vl_spec<'ast, 'snap>(
    ctx: &mut ExecutionContextSnapshot<'ast, 'snap>,
    data: &TaskData,
    component: VizComponentType,
    modifiers: &HashSet<VizComponentTypeModifier>,
    extra: sj::Map<String, sj::Value>,
) -> Result<sj::Map<String, sj::Value>, SystemError> {
    // Get encoding from extras
    let extra_encoding = match extra.get("encoding") {
        Some(sj::Value::Object(enc)) => enc.clone(),
        _ => sj::Map::new(),
    };

    // Find an encoding in the json object
    let find_encoding_from =
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

    // Try to find an encoding in the user data
    let find_encoding = |table: &TableMetadata,
                         name: &str,
                         assigned: &mut Vec<bool>|
     -> Result<Option<sj::Map<String, sj::Value>>, SystemError> {
        if let Some(field) = find_encoding_from(&extra, table, name, assigned)? {
            return Ok(Some(field));
        }
        if let Some(field) = find_encoding_from(&extra_encoding, table, name, assigned)? {
            return Ok(Some(field));
        }
        Ok(None)
    };

    // Assign an encoding field by force
    let force_encoding = |enc: Option<sj::Map<String, sj::Value>>,
                          table: &TableMetadata,
                          name: &str,
                          assigned: &mut Vec<bool>|
     -> Result<sj::Map<String, sj::Value>, SystemError> {
        if let Some(enc) = enc {
            return Ok(enc);
        }
        for (column_id, used) in assigned.iter_mut().enumerate() {
            if !*used {
                *used = true;
                let name = &table.column_names[column_id];
                let mut enc = sj::Map::new();
                enc.insert("field".to_string(), sj::Value::String(name.clone()));
                return Ok(enc);
            }
        }
        return Err(SystemError::Generic(format!(
            "could not assign required field: {}",
            name
        )));
    };

    match component {
        VizComponentType::AREA
        | VizComponentType::BAR
        | VizComponentType::LINE
        | VizComponentType::SCATTER
        | VizComponentType::PIE => {
            let table = assume_data_is_table(data)?;
            let is_stacked = modifiers.contains(&VizComponentTypeModifier::STACKED);
            let is_multi = modifiers.contains(&VizComponentTypeModifier::MULTI);

            // Build encodings
            let mut encodings: sj::Map<String, sj::Value> = Default::default();
            let mut assigned: Vec<bool> = Vec::new();
            assigned.resize(table.column_names.len(), false);
            match component {
                VizComponentType::AREA | VizComponentType::BAR | VizComponentType::LINE | VizComponentType::SCATTER => {
                    // Did the user specify anything?
                    let x = find_encoding(&table, "x", &mut assigned)?;
                    let y = find_encoding(&table, "y", &mut assigned)?;
                    let color = if is_stacked || is_multi {
                        find_encoding(&table, "color", &mut assigned)?
                    } else {
                        None
                    };

                    // Assign encodings by force
                    let mut x = force_encoding(x, &table, "x", &mut assigned)?;
                    let y = force_encoding(y, &table, "y", &mut assigned)?;
                    let color = if is_stacked || is_multi {
                        Some(force_encoding(color, &table, "color", &mut assigned)?)
                    } else {
                        None
                    };

                    // Do we need an xOffset?
                    let x_offset = if is_multi {
                        match component {
                            VizComponentType::BAR => color.clone(),
                            _ => None,
                        }
                    } else {
                        None
                    };

                    // Are we stacked?
                    x.insert("stacked".to_string(), sj::Value::Bool(is_stacked));

                    // Assemble encodings
                    encodings.insert("x".to_string(), sj::Value::Object(x));
                    encodings.insert("y".to_string(), sj::Value::Object(y));
                    if let Some(color) = color {
                        encodings.insert("color".to_string(), sj::Value::Object(color));
                    }
                    if let Some(x_offset) = x_offset {
                        encodings.insert("xOffset".to_string(), sj::Value::Object(x_offset));
                    }
                }
                VizComponentType::PIE => {
                    // required.extend_from_slice(&["theta", "radius"]);
                    todo!("pie chart")
                }
                _ => {}
            }

            // Get mark
            let mark = match component {
                VizComponentType::AREA => "area",
                VizComponentType::BAR => "bar",
                VizComponentType::LINE => "line",
                VizComponentType::PIE => "arc",
                VizComponentType::SCATTER => "point",
                _ => unreachable!(),
            };

            let mut vl: sj::Map<String, sj::Value> = sj::Map::new();
            vl.insert("mark".to_string(), sj::Value::String(mark.to_string()));
            vl.insert("encodings".to_string(), sj::Value::Object(encodings));
            Ok(vl)
        }
        _ => {
            return Err(SystemError::NotImplemented(format!(
                "generating vega spec for component type: {:?}",
                component
            )))
        }
    }
}

fn assume_data_is_table(data: &TaskData) -> Result<Arc<TableMetadata>, SystemError> {
    match data {
        TaskData::TableRef(t) => Ok(t.metadata.clone()),
        _ => Err(SystemError::Generic(
            "expected visualization data to be a table".to_string(),
        )),
    }
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
            viz_spec::{TableRendererData, VegaLiteRendererData, VizRendererData, VizSpec},
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
        let metadata = Arc::new(TableMetadata {
            table_name: "foo".to_string(),
            column_names: vec!["a".to_string()],
            column_types: vec![DataType::Int32],
            column_name_mapping: HashMap::from([("a".to_string(), 0)]),
            row_count: 1,
        });
        test_data(
            r#"
        create table foo as select 42 as a;
        visualize foo using table;
            "#,
            vec![
                TaskData::TableRef(TableRef {
                    name: "foo".to_string(),
                    metadata: metadata.clone(),
                    is_view: false,
                }),
                TaskData::VizData(VizData {
                    spec: Arc::new(VizSpec {
                        renderer: VizRendererData::Table(TableRendererData {
                            table: metadata.clone(),
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
        let metadata = Arc::new(TableMetadata {
            table_name: "foo".to_string(),
            column_names: vec!["a".to_string()],
            column_types: vec![DataType::Int32],
            column_name_mapping: HashMap::from([("a".to_string(), 0)]),
            row_count: 1,
        });
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
                    metadata: metadata.clone(),
                    is_view: false,
                }),
                TaskData::VizData(VizData {
                    spec: Arc::new(VizSpec {
                        renderer: VizRendererData::VegaLite(VegaLiteRendererData {
                            table: metadata.clone(),
                            sampling: None,
                            spec: json!({
                                "autosize": {
                                    "type": "fit",
                                    "contains": "padding",
                                    "resize": true,
                                },
                                "background": "transparent",
                                "padding": 8,
                                "width": "container",
                                "height": "container",
                                "layer": [{
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
                                }]
                            }),
                        }),
                    }),
                }),
            ],
        )
        .await?;
        Ok(())
    }
}

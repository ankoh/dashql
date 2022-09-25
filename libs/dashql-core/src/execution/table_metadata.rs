use std::{collections::HashMap, sync::Arc};

use arrow::{
    array::{Int32Array, StringArray},
    datatypes::DataType,
};
use serde::Serialize;

use crate::error::SystemError;

use super::execution_context::ExecutionContextSnapshot;

#[derive(Debug, Default, PartialEq, Serialize)]
pub struct TableMetadata {
    pub column_names: Vec<String>,
    pub column_name_mapping: HashMap<String, usize>,
    pub column_types: Vec<arrow::datatypes::DataType>,
    pub row_count: u64,
}

pub(crate) async fn resolve_table_metadata<'ast, 'snap>(
    ctx: &mut ExecutionContextSnapshot<'ast, 'snap>,
    table_name: &str,
) -> Result<Arc<TableMetadata>, SystemError> {
    let mut metadata = TableMetadata::default();
    let conn = &ctx.base.database_connection;
    let result = conn.run_query(&format!("DESCRIBE {}", &table_name)).await?;
    let batches = result.read_arrow_batches()?;
    for batch in batches.iter() {
        let column_names = batch
            .column(0)
            .as_any()
            .downcast_ref::<StringArray>()
            .ok_or(SystemError::InternalError("expected string column"))?;
        let column_types = batch
            .column(1)
            .as_any()
            .downcast_ref::<StringArray>()
            .ok_or(SystemError::InternalError("expected string column"))?;
        for i in 0..(batch.num_rows()) {
            let column_name = column_names.value(i).to_string();
            metadata
                .column_name_mapping
                .insert(column_name.clone(), metadata.column_names.len());
            metadata.column_names.push(column_name);
            metadata.column_types.push(match column_types.value(i) {
                "BOOLEAN" => DataType::Boolean,
                "TINYINT" => DataType::Int8,
                "SMALLINT" => DataType::Int16,
                "INTEGER" => DataType::Int32,
                "BIGINT" => DataType::Int64,
                "UTINYINT" => DataType::UInt8,
                "USMALLINT" => DataType::UInt16,
                "UINTEGER" => DataType::UInt32,
                "UBIGINT" => DataType::UInt64,
                "FLOAT" => DataType::Float32,
                "DOUBLE" => DataType::Float64,
                "HUGEINT" => DataType::Decimal(32, 0),
                "VARCHAR" => DataType::Utf8,
                "DATE" => DataType::Date32,
                "TIME" => DataType::Time32(arrow::datatypes::TimeUnit::Millisecond),
                "TIMESTAMP" => DataType::Time64(arrow::datatypes::TimeUnit::Nanosecond),
                _ => DataType::Null,
            });
        }
    }
    let result = conn
        .run_query(&format!("select count(*)::integer from {}", &table_name))
        .await?;
    let batches = result.read_arrow_batches()?;
    if batches.is_empty() || batches[0].num_rows() != 1 {
        return Err(SystemError::InternalError("couldn't get row count of table"));
    }
    let column = batches[0]
        .column(0)
        .as_any()
        .downcast_ref::<Int32Array>()
        .ok_or(SystemError::InternalError("couldn't get row count column of table"))?;
    metadata.row_count = column.value(0) as u64;
    return Ok(Arc::new(metadata));
}

#[cfg(test)]
mod test {
    use std::error::Error;

    use crate::execution::{execution_context::ExecutionContext, table_metadata::resolve_table_metadata};

    async fn test_simple(
        script: &'static str,
        table_name: &'static str,
        column_names: Vec<&'static str>,
        column_types: Vec<arrow::datatypes::DataType>,
        row_count: u64,
    ) -> Result<(), Box<dyn Error + Send + Sync>> {
        let arena = bumpalo::Bump::new();
        let ctx = ExecutionContext::create_simple(&arena).await?;
        let mut ctx_snap = ctx.snapshot();

        ctx_snap.base.database_connection.run_query(script).await?;

        let table = resolve_table_metadata(&mut ctx_snap, table_name).await?;
        assert_eq!(table.column_names, column_names);
        assert_eq!(table.column_types, column_types);
        assert_eq!(table.row_count, row_count);

        ctx_snap
            .base
            .database_connection
            .run_query(&format!("drop table if exists {}", table_name))
            .await?;
        Ok(())
    }

    #[tokio::test]
    async fn test_metadata_1() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_simple(
            r#"
            create table metadata_1 (
                a integer,
                b integer
            );"#,
            "metadata_1",
            vec!["a", "b"],
            vec![arrow::datatypes::DataType::Int32, arrow::datatypes::DataType::Int32],
            0,
        )
        .await?;
        Ok(())
    }
}

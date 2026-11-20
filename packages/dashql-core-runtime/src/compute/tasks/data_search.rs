//! The searches of a result: of the names of its columns, and of its data, the rows with a value that contains the
//! text. A search is case-insensitive and matches the text of a value.

use dashql_core::error::Result;
use dashql_core::utils::quote_string_literal;

use super::result_table::ResultTable;
use super::{ascending, data_frame_table_name, read_data_frame_sql, TaskQuery};
use crate::catalog_loader::sql::quote_identifier;
use crate::compute::types::{ColumnGroup, ComputationVersion, DataFrameId, DataSearchColumn, DataSearchTask};

/// The row number of a matching row in the result of a data search
pub const DATA_SEARCH_ROW_FIELD: &str = "row_idx";
/// The matching columns of a row in the result of a data search
pub const DATA_SEARCH_COLUMNS_FIELD: &str = "column_indices";
/// The matching column group in the result of a search of the columns
pub const COLUMN_SEARCH_GROUP_FIELD: &str = "column_group_idx";

/// The columns of the result that a search searches: the ordinal, string and list columns, numbered among themselves
pub fn collect_searchable_result_columns(column_groups: &[ColumnGroup]) -> Vec<DataSearchColumn> {
    let mut columns = Vec::new();
    for (column_group_idx, group) in column_groups.iter().enumerate() {
        let field_name = match group {
            ColumnGroup::RowNumber(_) | ColumnGroup::Skipped(_) => continue,
            ColumnGroup::Ordinal(column) => &column.input_field_name,
            ColumnGroup::String(column) => &column.input_field_name,
            ColumnGroup::List(column) => &column.input_field_name,
        };
        columns.push(DataSearchColumn {
            column_idx: columns.len() as u32,
            column_group_idx: column_group_idx as u32,
            field_name: field_name.clone(),
        });
    }
    columns
}

/// The search of the names of the columns, none without columns. It returns the matching `column_idx` and
/// `column_group_idx` in the order of the columns.
pub fn build_column_search_sql(columns: &[DataSearchColumn], pattern: &str) -> Option<String> {
    if columns.is_empty() {
        return None;
    }
    let values: Vec<String> = columns
        .iter()
        .map(|c| format!("({}, {}, {})", c.column_idx, c.column_group_idx, quote_string_literal(&c.field_name)))
        .collect();
    Some(format!(
        "SELECT column_idx, column_group_idx\nFROM (\n    VALUES\n        {}\n) AS columns(column_idx, column_group_idx, name)\nWHERE name ILIKE {}\nORDER BY column_idx",
        values.join(",\n        "),
        quote_string_literal(&format!("%{pattern}%"))
    ))
}

/// The search of the data of a table: every row with a matching value, with the matching columns. Without columns it
/// matches no row and still has the fields of a match.
pub fn build_data_search_sql(
    table_name: &str,
    row_number_field_name: &str,
    columns: &[DataSearchColumn],
    pattern: &str,
) -> String {
    let row_number = quote_identifier(row_number_field_name);
    let table = quote_identifier(table_name);
    if columns.is_empty() {
        return format!(
            "SELECT\n    {row_number} AS row_idx,\n    array_agg(0 ORDER BY 0) AS column_indices\nFROM {table}\nWHERE FALSE\nGROUP BY {row_number}\nORDER BY row_idx"
        );
    }
    let pattern = quote_string_literal(&format!("%{pattern}%"));
    let unions: Vec<String> = columns
        .iter()
        .map(|c| {
            format!(
                "    SELECT {row_number} AS row_idx, {} AS column_idx\n    FROM {table}\n    WHERE CAST({} AS TEXT) ILIKE {pattern}",
                c.column_idx,
                quote_identifier(&c.field_name)
            )
        })
        .collect();
    format!(
        "WITH search AS (\n{}\n)\nSELECT\n    row_idx,\n    array_agg(column_idx ORDER BY column_idx) AS column_indices\nFROM search\nGROUP BY row_idx\nORDER BY row_idx",
        unions.join("\n    UNION ALL\n")
    )
}

/// The matching column groups of a search of the columns, the field `column_group_idx` or the second field
pub fn parse_column_search_matches(result: &ResultTable) -> Result<Vec<u32>> {
    let second = (result.schema().fields().len() > 1).then_some(1);
    let Some(column) = result.column_index(COLUMN_SEARCH_GROUP_FIELD).or(second) else {
        return Ok(Vec::new());
    };
    Ok(result.int64_values(column)?.into_iter().flatten().filter_map(|group| u32::try_from(group).ok()).collect())
}

/// The query of a data search
#[derive(Clone, Debug, PartialEq)]
pub struct DataSearchPlan {
    /// The query
    pub query: TaskQuery,
    /// The row numbers of the searched data frame
    pub row_number_column_name: String,
    /// The version of the data that is searched
    pub version: ComputationVersion,
    /// The search request
    pub request_id: u64,
}

/// The rows that a data search matched. The host keeps the table of the matched rows that the query read, ordered by
/// row number with their matching columns, and parses the matching columns of a row itself.
#[derive(Clone, Debug, PartialEq)]
pub struct DataSearchResult {
    /// The row numbers that the table holds
    pub input_row_number_column_name: String,
    /// The data frame of the matched rows
    pub data_frame: DataFrameId,
    /// The version of the data that was searched
    pub version: ComputationVersion,
    /// The search request
    pub request_id: u64,
}

/// Plan a data search into a new data frame
pub fn plan_data_search(task: &DataSearchTask, output: DataFrameId) -> DataSearchPlan {
    let sql = build_data_search_sql(
        &data_frame_table_name(task.input_data_frame),
        &task.row_number_column_name,
        &task.columns,
        &task.pattern,
    );
    let read = read_data_frame_sql(output, Some(vec![ascending(DATA_SEARCH_ROW_FIELD)]), None);
    DataSearchPlan {
        query: TaskQuery::new("Data search", "Failed to search table data", output, sql, read),
        row_number_column_name: task.row_number_column_name.clone(),
        version: task.table_version,
        request_id: task.request_id,
    }
}

impl DataSearchPlan {
    /// The matched rows
    pub fn finish(self) -> DataSearchResult {
        DataSearchResult {
            input_row_number_column_name: self.row_number_column_name,
            data_frame: self.query.data_frame,
            version: self.version,
            request_id: self.request_id,
        }
    }
}

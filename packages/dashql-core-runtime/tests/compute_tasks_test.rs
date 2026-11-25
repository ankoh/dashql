//! Tests of the tasks of the computations.
//!
//! The tasks are sans-IO: a test checks the parts of the SQL of a plan that carry its meaning and hands batches to its
//! finish. Short statements are compared whole, long ones by their fragments, so that names of CTEs and whitespace
//! can change.

use std::sync::Arc;

use arrow_array::{
    Array, ArrayRef, BooleanArray, Float64Array, Int32Array, Int64Array, RecordBatch, StringArray, UInt64Array,
};
use arrow_schema::{DataType, Field, Schema, TimeUnit};

use dashql_core_runtime::compute::tasks::analysis::{analyze_string_column, BinBounds};
use dashql_core_runtime::compute::tasks::analyze_table::{
    column_aggregation_tasks, start_table_analysis, table_aggregation_task, AnalyzeTableOptions,
};
use dashql_core_runtime::compute::tasks::column_aggregation::{
    plan_column_aggregation, plan_filtered_column_aggregation, ColumnAggregateResult, FREQUENT_VALUE_COUNT,
};
use dashql_core_runtime::compute::tasks::columns::{build_column_groups, small_integer_domain_size, BIN_COUNT};
use dashql_core_runtime::compute::tasks::data_search::{
    build_column_search_sql, build_data_search_sql, collect_searchable_result_columns, parse_column_search_matches,
    plan_data_search,
};
use dashql_core_runtime::compute::tasks::result_table::ResultTable;
use dashql_core_runtime::compute::tasks::sql::{
    format_number, AggregateFunction, Binning, GroupBy, GroupByAggregate, GroupByKey, GroupByKeyBinning, SqlFrame,
};
use dashql_core_runtime::compute::tasks::system_columns::plan_system_columns;
use dashql_core_runtime::compute::tasks::table_aggregation::plan_table_aggregation;
use dashql_core_runtime::compute::tasks::table_filtering::plan_table_filtering;
use dashql_core_runtime::compute::tasks::table_ordering::plan_table_ordering;
use dashql_core_runtime::compute::tasks::{data_frame_table_name, TableStats};
use dashql_core_runtime::compute::types::{
    ArrowTable, ColumnAggregate, ColumnAggregationTask, ColumnGroup, ColumnStatsFields, ComputationVersion,
    DataSearchColumn, DataSearchTable, DataSearchTask, FilterOp, FilterTable, FilteredColumnAggregationTask,
    ListColumnGroup, OrderByConstraint, OrdinalColumnGroup, RowFilter, RowNumberColumnGroup, ScalarFilter,
    SkippedColumnGroup, StringColumnGroup, TableAggregation, TableFilteringTask, TableOrderingTask,
};

// ------------------------------------------------------------
// Helpers

/// An array of a column
fn a<T: Array + 'static>(array: T) -> ArrayRef {
    Arc::new(array)
}

/// A table of the host with a number per row, read by the runtime
fn arrow_table(id: u32, rows: i64) -> ArrowTable {
    let table = table(vec![("n", a(Int64Array::from_iter_values(0..rows)))]);
    ArrowTable::new(id, rows as u64, table.schema().clone())
}

/// A table of named columns
fn table(columns: Vec<(&str, ArrayRef)>) -> ResultTable {
    let batch = RecordBatch::try_from_iter(columns).expect("a batch");
    ResultTable::from_batch(batch)
}

fn order(field: &str, ascending: Option<bool>, nulls_first: Option<bool>) -> OrderByConstraint {
    OrderByConstraint { field: field.into(), ascending, nulls_first }
}

fn binning(fields: (&str, &str, &str), bin_count: u32, include_null_bin: bool) -> GroupByKeyBinning {
    GroupByKeyBinning {
        pre_binned_field_name: None,
        bin_count,
        min_bin_width: None,
        stats_table: "stats".into(),
        stats_min_field: fields.0.into(),
        stats_max_field: fields.1.into(),
        output_bin_lb_alias: format!("{}_lb", fields.2),
        output_bin_ub_alias: format!("{}_ub", fields.2),
        output_bin_width_alias: format!("{}_width", fields.2),
        include_null_bin,
        to_numeric: None,
    }
}

// ------------------------------------------------------------
// SQL generation

#[test]
fn sql_empty_transform() {
    assert_eq!(SqlFrame::from("t").to_sql(), r#"SELECT * FROM "t""#);
}

#[test]
fn sql_single_value_identifier() {
    let sql = SqlFrame::from("t").value_identifier("category", "cat_id").to_sql();
    // The distinct values numbered in ascending order with nulls last, the ids of dense_rank(), joined back to the
    // rows; null matches its own id
    assert_eq!(
        sql,
        r#"WITH
  __values_0 AS (
    SELECT "category" AS __value, CAST(row_number() OVER (ORDER BY "category" ASC NULLS LAST) AS BIGINT) AS __id FROM "t" GROUP BY "category"
  ),
  __value_ids AS (
    SELECT t.*, v0.__id AS "cat_id" FROM "t" t LEFT JOIN __values_0 v0 ON v0.__value IS NOT DISTINCT FROM t."category"
  )
SELECT * FROM __value_ids"#
    );
}

#[test]
fn sql_value_identifiers_join_one_dictionary_per_field() {
    let sql = SqlFrame::from("t").value_identifier("category", "cat_id").value_identifier("region", "reg_id").to_sql();
    assert!(sql.contains(r#"__values_0 AS (
    SELECT "category" AS __value, CAST(row_number() OVER (ORDER BY "category" ASC NULLS LAST) AS BIGINT) AS __id FROM "t" GROUP BY "category"
  )"#), "{sql}");
    assert!(sql.contains(r#"__values_1 AS (
    SELECT "region" AS __value, CAST(row_number() OVER (ORDER BY "region" ASC NULLS LAST) AS BIGINT) AS __id FROM "t" GROUP BY "region"
  )"#), "{sql}");
    // One select adds every id to the rows
    assert!(sql.contains(
        r#"SELECT t.*, v0.__id AS "cat_id", v1.__id AS "reg_id" FROM "t" t LEFT JOIN __values_0 v0 ON v0.__value IS NOT DISTINCT FROM t."category" LEFT JOIN __values_1 v1 ON v1.__value IS NOT DISTINCT FROM t."region""#
    ), "{sql}");
    assert!(!sql.contains("dense_rank"), "{sql}");
}

#[test]
fn sql_binning() {
    let sql = SqlFrame::from("t")
        .binning(Binning {
            field_name: "price".into(),
            stats_table: "stats".into(),
            stats_min_field: "min_price".into(),
            stats_max_field: "max_price".into(),
            bin_count: 8,
            min_bin_width: None,
            output_alias: "bin".into(),
            to_numeric: None,
        })
        .to_sql();
    // The bin of a value is its distance from the minimum in widths of a bin, the width splits the range in 8
    assert!(sql.contains(r#"(CAST(t."price" AS DOUBLE PRECISION) - "#), "{sql}");
    assert!(sql.contains(r#"AS "bin" FROM "t" t CROSS JOIN"#), "{sql}");
    assert!(sql.contains(r#"CAST("min_price" AS DOUBLE PRECISION) AS __min"#), "{sql}");
    assert!(
        sql.contains(
            r#"GREATEST(ABS(CAST("max_price" AS DOUBLE PRECISION) - CAST("min_price" AS DOUBLE PRECISION)) / 8, 1e-15)"#
        ),
        "{sql}"
    );
    assert!(sql.contains(r#"FROM "stats""#), "{sql}");
}

#[test]
fn sql_binning_converts_temporal_and_boolean_values() {
    let frame = |to_numeric| {
        SqlFrame::from("input")
            .binning(Binning {
                field_name: "v".into(),
                stats_table: "stats".into(),
                stats_min_field: "mn".into(),
                stats_max_field: "mx".into(),
                bin_count: 2,
                min_bin_width: Some(1.0),
                output_alias: "b".into(),
                to_numeric: Some(to_numeric),
            })
            .to_sql()
    };
    use dashql_core_runtime::compute::tasks::sql::ToNumeric;
    let epoch = frame(ToNumeric::Epoch);
    assert!(epoch.contains("EXTRACT(EPOCH FROM t.\"v\")"));
    assert!(epoch.contains("GREATEST(ABS(EXTRACT(EPOCH FROM \"mx\") - EXTRACT(EPOCH FROM \"mn\")) / 2, 1)"));
    assert!(frame(ToNumeric::TimeEpoch).contains("EXTRACT(EPOCH FROM CAST(t.\"v\" AS INTERVAL))"));
    assert!(frame(ToNumeric::Boolean).contains("CASE WHEN t.\"v\" THEN 1.0 WHEN NOT t.\"v\" THEN 0.0 END"));
}

#[test]
fn sql_scalar_filter() {
    let sql = SqlFrame::from("t")
        .filter("score", FilterOp::GreaterEqual, 10.0)
        .filter("score", FilterOp::LessEqual, 20.0)
        .to_sql();
    assert!(sql.contains(r#"SELECT * FROM "t" WHERE "score" >= 10 AND "score" <= 20"#), "{sql}");
}

#[test]
fn sql_in_filter() {
    // Several integers filter with IN, one with =, none keeps no row
    let sql = SqlFrame::from("t").filter_in("_name_id", vec![2, 5, 9]).filter_in("_kind_id", vec![-1]).to_sql();
    assert_eq!(
        sql,
        r#"WITH
  __filtered AS (
    SELECT * FROM "t" WHERE "_name_id" IN (2, 5, 9) AND "_kind_id" = -1
  )
SELECT * FROM __filtered"#
    );
    let sql = SqlFrame::from("t").filter_in("_name_id", Vec::new()).to_sql();
    assert!(sql.contains(r#"SELECT * FROM "t" WHERE FALSE"#), "{sql}");
}

#[test]
fn sql_semi_join_filter() {
    let sql = SqlFrame::from("t").semi_join_filter("id", "filter_tbl", "fid").to_sql();
    assert!(sql.contains(r#"SELECT * FROM "t" WHERE "id" IN (SELECT "fid" FROM "filter_tbl")"#), "{sql}");
}

#[test]
fn sql_simple_group_by() {
    let sql = SqlFrame::from("t")
        .group_by(GroupBy {
            keys: vec![GroupByKey::new("category", "key")],
            aggregates: vec![GroupByAggregate::new(AggregateFunction::CountStar, "cnt")],
        })
        .to_sql();
    assert!(sql.contains(r#"SELECT "category" AS "key", COUNT(*) AS "cnt" FROM "t" GROUP BY 1"#), "{sql}");
}

#[test]
fn sql_global_aggregation() {
    let sql = SqlFrame::from("t")
        .group_by(GroupBy {
            keys: vec![],
            aggregates: vec![
                GroupByAggregate::new(AggregateFunction::Min("score".into()), "min_score"),
                GroupByAggregate::new(AggregateFunction::Max("score".into()), "max_score"),
            ],
        })
        .to_sql();
    assert!(sql.contains(r#"MIN("score") AS "min_score""#));
    assert!(sql.contains(r#"MAX("score") AS "max_score""#));
    assert!(!sql.contains("GROUP BY"));
}

#[test]
fn sql_binned_group_by() {
    let sql = SqlFrame::from("t")
        .group_by(GroupBy {
            keys: vec![GroupByKey {
                field_name: "price".into(),
                output_alias: "bin".into(),
                binning: Some(binning(("min_val", "max_val", "bin"), 8, true)),
            }],
            aggregates: vec![GroupByAggregate::new(AggregateFunction::CountStar, "count")],
        })
        .to_sql();
    // The width splits the range of the stats in 8 bins
    assert!(sql.contains(
        r#"GREATEST(ABS(CAST("max_val" AS DOUBLE PRECISION) - CAST("min_val" AS DOUBLE PRECISION)) / 8, 1e-15)"#
    ));
    // Null goes into the extra bin 8, the maximum into the last bin 7, values below the minimum into bin 0
    assert!(sql.contains(r#"CASE WHEN t."price" IS NULL THEN 8 ELSE"#), "{sql}");
    assert!(sql.contains(">= 8 THEN 7"), "{sql}");
    assert!(sql.contains("ELSE 0 END AS INTEGER) END AS \"bin\""), "{sql}");
    assert!(sql.contains(r#"COUNT(*) AS "count""#), "{sql}");
    // Every bin is a row, also the empty ones
    assert!(sql.contains(r#"generate_series(0, 8) AS bins("bin")"#), "{sql}");
    assert!(sql.contains("LEFT JOIN"), "{sql}");
    // The null bin has no bounds
    assert_eq!(sql.matches(r#"CASE WHEN "bin" = 8 THEN NULL ELSE "#).count(), 3, "{sql}");
    for alias in ["bin_width", "bin_lb", "bin_ub"] {
        assert!(sql.contains(&format!(r#"AS "{alias}""#)), "{alias}: {sql}");
    }
}

#[test]
fn sql_binned_group_by_without_null_bin() {
    let sql = SqlFrame::from("t")
        .group_by(GroupBy {
            keys: vec![GroupByKey {
                field_name: "price".into(),
                output_alias: "bin".into(),
                binning: Some(binning(("mn", "mx", "b"), 4, false)),
            }],
            aggregates: vec![GroupByAggregate::new(AggregateFunction::CountStar, "cnt")],
        })
        .to_sql();
    assert!(sql.contains("FROM generate_series(0, 3)"));
    assert!(!sql.contains("IS NULL THEN"));
    assert!(!sql.contains("CASE WHEN \"bin\" ="));
}

#[test]
fn sql_binned_group_by_keeps_temporal_bounds_as_epoch_milliseconds() {
    use dashql_core_runtime::compute::tasks::sql::ToNumeric;
    let mut key_binning = binning(("mn", "mx", "bin"), 2, false);
    key_binning.to_numeric = Some(ToNumeric::TimeEpoch);
    let sql = SqlFrame::from("input")
        .group_by(GroupBy {
            keys: vec![GroupByKey { field_name: "at".into(), output_alias: "bin".into(), binning: Some(key_binning) }],
            aggregates: vec![GroupByAggregate::new(AggregateFunction::CountStar, "count")],
        })
        .to_sql();
    assert!(sql.contains("SELECT \"mn\" AS __min"));
    assert!(sql.contains(
        "(EXTRACT(EPOCH FROM CAST(t.\"at\" AS INTERVAL)) - EXTRACT(EPOCH FROM CAST(s.__min AS INTERVAL))) / s.__bin_width"
    ));
    assert!(sql.contains(
        "EXTRACT(EPOCH FROM CAST(s.__min AS INTERVAL)) * 1000.0 + (\"bin\" * s.__bin_width) * 1000.0 AS \"bin_lb\""
    ));
}

#[test]
fn sql_order_by_with_nulls() {
    let sql = SqlFrame::from("t")
        .order_by(vec![order("a", Some(true), Some(false)), order("b", Some(false), Some(true))], None)
        .to_sql();
    assert_eq!(sql, "SELECT * FROM \"t\"\nORDER BY \"a\" ASC NULLS LAST, \"b\" DESC NULLS FIRST");
}

#[test]
fn sql_order_by_with_limit() {
    let sql = SqlFrame::from("t").order_by(vec![order("x", None, None)], Some(50)).to_sql();
    assert_eq!(sql, "SELECT * FROM \"t\"\nORDER BY \"x\" ASC NULLS LAST\nLIMIT 50");
}

#[test]
fn sql_projection() {
    let sql = SqlFrame::from("t").project(vec!["id".into(), "name".into()]).to_sql();
    assert_eq!(sql, r#"SELECT "id", "name" FROM "t""#);
}

#[test]
fn sql_filter_order_and_projection() {
    let sql = SqlFrame::from("input")
        .filter("score", FilterOp::GreaterEqual, 10.0)
        .order_by(vec![order("rn", None, None)], None)
        .project(vec!["rn".into()])
        .to_sql();
    assert!(sql.contains("__filtered"));
    assert!(sql.contains(r#"SELECT "rn" FROM __filtered"#));
    assert!(sql.contains(r#"ORDER BY "rn" ASC NULLS LAST"#));
}

#[test]
fn sql_quotes_identifiers() {
    let sql = SqlFrame::from("my table").project(vec!["row num".into()]).to_sql();
    assert!(sql.contains(r#""my table""#));
    assert!(sql.contains(r#""row num""#));
    assert_eq!(SqlFrame::from("a\"b").to_sql(), r#"SELECT * FROM "a""b""#);
}

#[test]
fn sql_formats_numbers_like_javascript() {
    let cases = [
        (10.0, "10"),
        (10.1, "10.1"),
        (-2.5, "-2.5"),
        (0.0, "0"),
        (1e-15, "1e-15"),
        (1e-7, "1e-7"),
        (0.000001, "0.000001"),
        (123456789.0, "123456789"),
        (1e21, "1e+21"),
        (1.5e300, "1.5e+300"),
        (f64::NAN, "NaN"),
        (f64::NEG_INFINITY, "-Infinity"),
    ];
    for (value, expected) in cases {
        assert_eq!(format_number(value), expected, "{value}");
    }
}

// ------------------------------------------------------------
// Searches

fn search_column_groups() -> Vec<ColumnGroup> {
    let string = |name: &str| {
        ColumnGroup::String(StringColumnGroup {
            input_field_name: name.into(),
            input_field_type: "Utf8".into(),
            input_field_nullable: true,
            stats_fields: None,
            value_id_field_name: None,
        })
    };
    vec![
        ColumnGroup::RowNumber(RowNumberColumnGroup { row_number_field_name: "_rownum".into() }),
        string("column_name"),
        ColumnGroup::Ordinal(OrdinalColumnGroup {
            input_field_name: "score".into(),
            input_field_type: "Float64".into(),
            input_field_nullable: false,
            stats_fields: None,
            bin_field_name: Some("_2_bin".into()),
            bin_count: 8,
        }),
        ColumnGroup::List(ListColumnGroup {
            input_field_name: "tags".into(),
            input_field_type: "List".into(),
            input_field_nullable: true,
            stats_fields: None,
            value_id_field_name: None,
        }),
        ColumnGroup::Skipped(SkippedColumnGroup {
            input_field_name: "blob".into(),
            input_field_type: "Binary".into(),
            input_field_nullable: true,
        }),
        string("col\"umn"),
    ]
}

fn search_column(column_idx: u32, column_group_idx: u32, field_name: &str) -> DataSearchColumn {
    DataSearchColumn { column_idx, column_group_idx, field_name: field_name.into() }
}

#[test]
fn search_collects_original_data_columns() {
    assert_eq!(
        collect_searchable_result_columns(&search_column_groups()),
        vec![
            search_column(0, 1, "column_name"),
            search_column(1, 2, "score"),
            search_column(2, 3, "tags"),
            search_column(3, 5, "col\"umn"),
        ]
    );
}

#[test]
fn search_inlines_column_names() {
    let sql = build_column_search_sql(&collect_searchable_result_columns(&search_column_groups()), "_na").unwrap();
    for row in ["(0, 1, 'column_name')", "(1, 2, 'score')", "(2, 3, 'tags')", "(3, 5, 'col\"umn')"] {
        assert!(sql.contains(row), "{row}: {sql}");
    }
    assert!(sql.contains("WHERE name ILIKE '%_na%'"), "{sql}");
    assert!(sql.contains("ORDER BY column_idx"), "{sql}");
}

#[test]
fn search_quotes_single_quotes() {
    let sql = build_column_search_sql(&[search_column(0, 1, "o'neil")], "o'neil").unwrap_or_default();
    assert!(sql.contains("(0, 1, 'o''neil')"));
    assert!(sql.contains("WHERE name ILIKE '%o''neil%'"));
}

#[test]
fn search_without_columns() {
    assert_eq!(build_column_search_sql(&[], "x"), None);
    assert!(build_data_search_sql("__syscols_1", "_rownum", &[], "x").contains("WHERE FALSE"));
}

#[test]
fn search_data_of_every_column() {
    let sql = build_data_search_sql(
        "__syscols_1",
        "_rownum",
        &collect_searchable_result_columns(&search_column_groups()),
        "search",
    );
    // Every column is searched as text, its matches carry the index of the column
    for (idx, field) in [(0, "\"column_name\""), (1, "\"score\""), (2, "\"tags\""), (3, "\"col\"\"umn\"")] {
        assert!(sql.contains(&format!("{idx} AS column_idx")), "{idx}: {sql}");
        assert!(sql.contains(&format!("WHERE CAST({field} AS TEXT) ILIKE '%search%'")), "{field}: {sql}");
    }
    assert_eq!(sql.matches("UNION ALL").count(), 3, "{sql}");
    assert!(sql.contains(r#"FROM "__syscols_1""#), "{sql}");
    // One row per matching row with the indices of its matching columns, ordered by row
    assert!(sql.contains("array_agg(column_idx ORDER BY column_idx) AS column_indices"), "{sql}");
    assert!(sql.contains("GROUP BY row_idx"), "{sql}");
    assert!(sql.trim_end().ends_with("ORDER BY row_idx"), "{sql}");
}

#[test]
fn search_parses_matching_column_groups() {
    let result = table(vec![
        ("column_idx", a(Int32Array::from(vec![0, 3]))),
        ("column_group_idx", a(Int64Array::from(vec![1, 5]))),
    ]);
    assert_eq!(parse_column_search_matches(&result).expect("matches"), vec![1, 5]);
}

#[test]
fn data_search_reads_the_matching_rows_ordered_by_row() {
    let task = DataSearchTask {
        table_id: 1,
        table_version: ComputationVersion::new(1, 2),
        input_data_frame: 10,
        row_number_column_name: "rownum".into(),
        columns: vec![search_column(0, 1, "name")],
        pattern: "ann".into(),
        request_id: 7,
    };
    let plan = plan_data_search(&task, 11);
    assert_eq!(plan.query.table_name, "__df_11");
    assert!(plan.query.sql.contains("FROM \"__df_10\""));
    assert!(plan.query.sql.starts_with("WITH search AS ("));
    assert_eq!(plan.query.read_sql, "SELECT * FROM \"__df_11\"\nORDER BY \"row_idx\" ASC NULLS LAST");

    // The host keeps the rows that the search matched
    let result = plan.finish();
    assert_eq!(result.input_row_number_column_name, "rownum");
    assert_eq!(result.data_frame, 11);
    assert_eq!(result.version, ComputationVersion::new(1, 2));
    assert_eq!(result.request_id, 7);
}

#[test]
fn data_search_wraps_failures() {
    let plan = plan_data_search(
        &DataSearchTask {
            table_id: 1,
            table_version: ComputationVersion::default(),
            input_data_frame: 10,
            row_number_column_name: "rownum".into(),
            columns: vec![],
            pattern: "x".into(),
            request_id: 1,
        },
        11,
    );
    assert!(plan.query.failed("read failed").to_string().starts_with("Failed to search table data"));
}

// ------------------------------------------------------------
// The analysis of a table

#[test]
fn analysis_ignores_results_without_columns() {
    assert_eq!(start_table_analysis(&Schema::empty(), 1), None);
}

#[test]
fn analysis_classifies_the_columns() {
    let schema = Schema::new(vec![
        Field::new("i", DataType::Int32, false),
        Field::new("f", DataType::Float64, true),
        Field::new("b", DataType::Boolean, true),
        Field::new("t", DataType::Timestamp(TimeUnit::Millisecond, None), true),
        Field::new("s", DataType::Utf8, true),
        Field::new("l", DataType::List(Arc::new(Field::new("item", DataType::Float32, true))), true),
        Field::new("x", DataType::Binary, true),
        Field::new("v", DataType::Interval(arrow_schema::IntervalUnit::DayTime), true),
    ]);
    let groups = build_column_groups(&schema);
    let kinds: Vec<&str> = groups.iter().map(ColumnGroup::type_name).collect();
    assert_eq!(kinds, ["ORDINAL", "ORDINAL", "ORDINAL", "ORDINAL", "STRING", "LIST", "SKIPPED", "SKIPPED"]);
    let ColumnGroup::Ordinal(first) = &groups[0] else { panic!("an ordinal column") };
    assert_eq!(first.bin_count, BIN_COUNT);
    assert!(!first.input_field_nullable);
}

#[test]
fn analysis_names_the_row_numbers_apart_from_the_fields() {
    let schema = Arc::new(Schema::new(vec![Field::new("_rownum", DataType::Utf8, true)]));
    let batch = |values: Vec<&str>| {
        RecordBatch::try_new(schema.clone(), vec![a(StringArray::from(values)) as ArrayRef]).expect("a batch")
    };
    let input = ResultTable::try_new(schema.clone(), vec![batch(vec!["a", "b"]), batch(vec!["c"])]).expect("a table");
    let start = start_table_analysis(input.schema(), 3).expect("columns");
    // The row numbers don't take the name of a field
    assert_eq!(start.row_number_field_name, "__rownum");
    assert_eq!(start.fields, vec!["_rownum".to_string()]);
    assert_eq!(start.import.table_name, "__df_3");
    // The host numbers the rows across the batches, like a table of the runtime
    let numbered = &input.append_row_numbers(&start.row_number_field_name).expect("numbers");
    let column = numbered.column_index("__rownum").expect("row numbers");
    assert_eq!(numbered.int64_values(column).expect("ints"), vec![Some(1), Some(2), Some(3)]);
    assert_eq!(numbered.batches().len(), 2);
    // The import crosses as IPC
    let bytes = numbered.to_ipc_stream().expect("IPC");
    assert_eq!(&ResultTable::from_ipc_stream(&bytes).expect("a table"), numbered);
}

fn integer_aggregation(min: i32, max: i32) -> Vec<ColumnGroup> {
    let schema = Schema::new(vec![Field::new("value", DataType::Int32, false)]);
    let task = table_aggregation_task(1, build_column_groups(&schema), 10);
    let plan = plan_table_aggregation(&task, 11);
    let count = i64::from(max - min + 1);
    let stats = table(vec![
        ("_count", a(Int64Array::from(vec![count]))),
        ("_0_count", a(Int64Array::from(vec![count]))),
        ("_0_min", a(Int32Array::from(vec![min]))),
        ("_0_max", a(Int32Array::from(vec![max]))),
    ]);
    plan.finish(&schema, stats).expect("statistics").column_groups
}

fn bin_count(group: &ColumnGroup) -> u32 {
    match group {
        ColumnGroup::Ordinal(column) => column.bin_count,
        _ => 0,
    }
}

#[test]
fn table_aggregation_uses_one_bin_per_value_of_small_integer_domains() {
    assert_eq!(bin_count(&integer_aggregation(0, 9)[0]), 10);
}

#[test]
fn table_aggregation_keeps_the_bins_of_wider_integer_domains() {
    assert_eq!(bin_count(&integer_aggregation(0, BIN_COUNT as i32)[0]), BIN_COUNT);
}

#[test]
fn table_aggregation_counts_and_names_the_statistics() {
    let schema = Schema::new(vec![
        Field::new("score", DataType::Float64, true),
        Field::new("name", DataType::Utf8, true),
        Field::new("tags", DataType::List(Arc::new(Field::new("item", DataType::Int32, true))), true),
    ]);
    let plan = plan_table_aggregation(&table_aggregation_task(1, build_column_groups(&schema), 10), 11);
    // The numbers get their range, the strings their distinct count, the list no statistics
    let sql = &plan.query.sql;
    for aggregate in [
        r#"COUNT(*) AS "_count""#,
        r#"COUNT("score") AS "_0_count""#,
        r#"MIN("score") AS "_0_min""#,
        r#"MAX("score") AS "_0_max""#,
        r#"COUNT("name") AS "_1_count""#,
        r#"APPROX_COUNT_DISTINCT("name") AS "_1_countd""#,
    ] {
        assert!(sql.contains(aggregate), "{aggregate}: {sql}");
    }
    assert!(!sql.contains("tags"), "{sql}");
    assert!(sql.contains(r#"FROM "__df_10""#), "{sql}");
    let ColumnGroup::String(name) = &plan.column_groups[1] else { panic!("a string column") };
    assert_eq!(name.stats_fields.as_ref().and_then(|f| f.distinct_count_field_name.as_deref()), Some("_1_countd"));
    let ColumnGroup::List(tags) = &plan.column_groups[2] else { panic!("a list column") };
    assert_eq!(tags.stats_fields, None);
}

#[test]
fn small_integer_domains() {
    assert_eq!(small_integer_domain_size(Some(0), Some(9), 16), Some(10));
    assert_eq!(small_integer_domain_size(Some(0), Some(16), 16), None);
    assert_eq!(small_integer_domain_size(Some(5), Some(4), 16), None);
    assert_eq!(small_integer_domain_size(None, Some(4), 16), None);
    assert_eq!(small_integer_domain_size(Some(i128::from(u64::MAX) - 1), Some(i128::from(u64::MAX)), 16), Some(2));
}

#[test]
fn table_aggregation_reads_unsigned_integers_exactly() {
    let schema = Schema::new(vec![Field::new("value", DataType::UInt64, false)]);
    let plan = plan_table_aggregation(&table_aggregation_task(1, build_column_groups(&schema), 10), 11);
    let stats = table(vec![
        ("_count", a(Int64Array::from(vec![2]))),
        ("_0_count", a(Int64Array::from(vec![2]))),
        ("_0_min", a(UInt64Array::from(vec![u64::MAX - 1]))),
        ("_0_max", a(UInt64Array::from(vec![u64::MAX]))),
    ]);
    assert_eq!(bin_count(&plan.finish(&schema, stats).expect("statistics").column_groups[0]), 2);
}

// ------------------------------------------------------------
// System columns, filtering and ordering

fn stats_aggregation() -> TableAggregation {
    TableAggregation { table: arrow_table(50, 1), data_frame: 20, count_star_field_name: "_count".into() }
}

#[test]
fn system_columns_bin_and_number_the_values_in_the_order_of_the_rows() {
    let schema = Schema::new(vec![
        Field::new("query", DataType::Utf8, true),
        Field::new("total_ms", DataType::Int64, true),
        Field::new("_1_id", DataType::Utf8, true),
    ]);
    let plan = plan_table_aggregation(&table_aggregation_task(1, build_column_groups(&schema), 10), 11);
    let task = dashql_core_runtime::compute::tasks::analyze_table::system_columns_task(
        1,
        plan.column_groups,
        arrow_table(1, 3),
        10,
        "_rownum".into(),
        stats_aggregation(),
    );
    let plan = plan_system_columns(&task, &schema, 12).expect("a plan");
    // The strings get ids in the order of their values, a name of the result that looks like a system column gets
    // another prefix; the numbers get bins over the range of the statistics
    let sql = &plan.query.sql;
    assert!(sql.contains(r#"(ORDER BY "query" ASC NULLS LAST) AS BIGINT) AS __id FROM "__df_10" GROUP BY"#), "{sql}");
    assert!(sql.contains(r#"v0.__id AS "__1_id""#), "{sql}");
    assert!(sql.contains(r#"(ORDER BY "_1_id" ASC NULLS LAST) AS BIGINT) AS __id FROM "__df_10" GROUP BY"#), "{sql}");
    assert!(sql.contains(r#"v1.__id AS "_3_id""#), "{sql}");
    // The bins are computed over the rows with their ids
    assert!(sql.contains(r#"FROM __value_ids t CROSS JOIN"#), "{sql}");
    assert!(sql.contains(r#"FROM "__df_10""#), "{sql}");
    assert!(sql.contains(r#"(CAST(t."total_ms" AS DOUBLE PRECISION) - "#), "{sql}");
    assert!(sql.contains(r#"AS "_2_bin""#), "{sql}");
    assert!(sql.contains(&format!(r#"CAST("_1_min" AS DOUBLE PRECISION)) / {BIN_COUNT}, 1)"#)), "{sql}");
    assert!(sql.contains(r#"FROM "__df_20""#), "{sql}");
    // The rows are read in the order of the result
    assert_eq!(plan.query.read_sql, "SELECT * FROM \"__df_12\"\nORDER BY \"_rownum\" ASC NULLS LAST");
    assert_eq!(
        plan.column_groups.iter().map(ColumnGroup::type_name).collect::<Vec<_>>(),
        ["ROWNUMBER", "STRING", "ORDINAL", "STRING"]
    );
    let ColumnGroup::Ordinal(total) = &plan.column_groups[2] else { panic!("an ordinal column") };
    assert_eq!(total.bin_field_name.as_deref(), Some("_2_bin"));
    assert_eq!(plan.finish().data_frame, 12);
}

#[test]
fn table_filtering_lists_the_rows_in_the_order_of_the_input() {
    let mut task = TableFilteringTask {
        table_id: 1,
        table_version: ComputationVersion::new(0, 1),
        input_data_table: arrow_table(1, 100),
        input_data_frame: 10,
        row_number_column_name: "_rownum".into(),
        filters: vec![],
    };
    assert_eq!(plan_table_filtering(&task, 11), None);
    task.filters.push(ScalarFilter { field_name: "value".into(), op: FilterOp::GreaterEqual, value: 50.0 }.into());
    task.filters.push(RowFilter::In { field_name: "_name_id".into(), values: vec![1, 4] });
    let plan = plan_table_filtering(&task, 11).expect("a filter");
    let sql = &plan.query.sql;
    assert!(sql.contains(r#"FROM "__df_10" WHERE "value" >= 50 AND "_name_id" IN (1, 4)"#), "{sql}");
    assert!(sql.contains(r#"SELECT "_rownum" FROM"#), "{sql}");
    assert_eq!(plan.query.read_sql, "SELECT * FROM \"__df_11\"\nORDER BY \"_rownum\" ASC NULLS LAST");
    let filter = plan.finish();
    assert_eq!(filter.version, ComputationVersion::new(0, 1));
    assert!(filter.data_frame == 11);
}

#[test]
fn table_ordering_orders_equal_rows_by_their_row_number() {
    let task = TableOrderingTask {
        table_id: 1,
        table_version: ComputationVersion::new(0, 1),
        input_data_table: arrow_table(1, 100),
        input_data_frame: 10,
        filter_table: Some(FilterTable {
            input_row_number_column_name: "_rownum".into(),
            table: arrow_table(2, 5),
            data_frame: 20,
            version: ComputationVersion::new(0, 1),
        }),
        data_search_table: Some(DataSearchTable {
            input_row_number_column_name: "_rownum".into(),
            table: arrow_table(3, 5),
            data_frame: 30,
            version: ComputationVersion::new(0, 1),
            request_id: 4,
        }),
        row_number_column_name: "_rownum".into(),
        ordering_constraints: vec![order("group", Some(false), None), order("_rownum", None, None)],
    };
    let plan = plan_table_ordering(&task, 11);
    // The rows are those of the filter and of the search
    let sql = &plan.query.sql;
    assert!(sql.contains(r#"FROM "__df_10""#), "{sql}");
    assert!(sql.contains(r#""_rownum" IN (SELECT "_rownum" FROM "__df_20")"#), "{sql}");
    assert!(sql.contains(r#""_rownum" IN (SELECT "row_idx" FROM "__df_30")"#), "{sql}");
    assert!(sql.contains(r#"SELECT "_rownum", "group" FROM"#), "{sql}");
    // The constraints come first, the row number orders the rest
    let read_sql = &plan.query.read_sql;
    assert!(read_sql.starts_with(r#"SELECT "_rownum" FROM "__df_11""#), "{read_sql}");
    assert!(read_sql.contains(r#"ORDER BY "group" DESC NULLS LAST, "_rownum" ASC NULLS LAST"#), "{read_sql}");
    assert!(read_sql.trim_end().ends_with(r#""_rownum" ASC NULLS LAST"#), "{read_sql}");
    let ordering = plan.finish();
    assert_eq!(ordering.data_search_request_id, Some(4));
    assert_eq!(ordering.ordering_constraints.len(), 2);
}

// ------------------------------------------------------------
// The summaries of columns

/// The statistics of the string column name (_0) and the ordinal column score (_1)
fn stats() -> TableStats {
    let table = table(vec![
        ("_count_star", a(Int64Array::from(vec![10]))),
        ("_0_count", a(Int64Array::from(vec![8]))),
        ("_0_distinct", a(Int64Array::from(vec![3]))),
        ("_1_count", a(Int64Array::from(vec![9]))),
        ("_1_min", a(Float64Array::from(vec![1.0]))),
        ("_1_max", a(Float64Array::from(vec![9.0]))),
    ]);
    TableStats::read(20, &table, "_count_star").expect("the statistics")
}

fn name_column() -> ColumnGroup {
    ColumnGroup::String(StringColumnGroup {
        input_field_name: "name".into(),
        input_field_type: "Utf8".into(),
        input_field_nullable: true,
        stats_fields: Some(ColumnStatsFields {
            count_field_name: "_0_count".into(),
            distinct_count_field_name: Some("_0_distinct".into()),
            min_aggregate_field_name: None,
            max_aggregate_field_name: None,
        }),
        value_id_field_name: Some("name_id".into()),
    })
}

fn score_column() -> ColumnGroup {
    ColumnGroup::Ordinal(OrdinalColumnGroup {
        input_field_name: "score".into(),
        input_field_type: "Float64".into(),
        input_field_nullable: true,
        stats_fields: Some(ColumnStatsFields {
            count_field_name: "_1_count".into(),
            distinct_count_field_name: None,
            min_aggregate_field_name: Some("_1_min".into()),
            max_aggregate_field_name: Some("_1_max".into()),
        }),
        bin_field_name: None,
        bin_count: 2,
    })
}

fn result_schema() -> Schema {
    Schema::new(vec![Field::new("name", DataType::Utf8, true), Field::new("score", DataType::Float64, true)])
}

/// A summary task of a column, filtered by a cross filter and a data search
fn filtered_task(column_entry: ColumnGroup) -> FilteredColumnAggregationTask {
    FilteredColumnAggregationTask {
        column: ColumnAggregationTask {
            table_id: 1,
            table_version: ComputationVersion::new(1, 2),
            column_id: 0,
            column_entry,
            input_data_frame: 10,
            table_aggregate: TableAggregation {
                table: arrow_table(50, 1),
                data_frame: 20,
                count_star_field_name: "_count_star".into(),
            },
        },
        filter_table: Some(FilterTable {
            input_row_number_column_name: "rownum".into(),
            table: arrow_table(2, 1),
            data_frame: 30,
            version: ComputationVersion::new(1, 2),
        }),
        data_search_table: Some(DataSearchTable {
            input_row_number_column_name: "rownum".into(),
            table: arrow_table(3, 1),
            data_frame: 40,
            version: ComputationVersion::new(1, 2),
            request_id: 9,
        }),
        selection_row_count: 5,
        unfiltered_aggregate: ColumnAggregate::Skipped,
    }
}

#[test]
fn filtered_column_aggregation_counts_the_frequent_values_of_the_selected_rows() {
    let plan = plan_filtered_column_aggregation(&filtered_task(name_column()), &result_schema(), 11).expect("a plan");
    assert!(plan.plan.query.sql.contains("\"rownum\" IN (SELECT \"rownum\" FROM \"__df_30\")"));
    assert!(plan.plan.query.sql.contains("\"rownum\" IN (SELECT \"row_idx\" FROM \"__df_40\")"));
    assert!(plan.plan.query.sql.contains(&format!("ORDER BY \"count\" DESC NULLS LAST\nLIMIT {FREQUENT_VALUE_COUNT}")));
    assert_eq!(plan.plan.query.read_sql, "SELECT * FROM \"__df_11\"\nORDER BY \"count\" DESC NULLS LAST");

    let frequent = table(vec![
        ("key", a(StringArray::from(vec!["a", "b"]))),
        ("keyId", a(Int64Array::from(vec![1, 2]))),
        ("count", a(Int64Array::from(vec![4, 2]))),
    ]);
    let result = plan.finish(&stats(), frequent).expect("a summary");
    assert_eq!(result.filter_version, ComputationVersion::new(1, 2));
    assert_eq!(result.data_search_request_id, Some(9));
    let ColumnAggregateResult::String { analysis, data_frame, .. } = result.aggregate else {
        panic!("a string summary")
    };
    assert_eq!(data_frame, 11);
    assert_eq!(analysis.total_count, 5);
    assert_eq!(analysis.count_not_null, 8);
    assert_eq!(analysis.count_null, 2);
    assert_eq!(analysis.count_distinct, 3);
    assert!(!analysis.is_unique);
    assert_eq!(analysis.frequent_value_strings, vec![Some("a".to_string()), Some("b".to_string())]);
    assert_eq!(analysis.frequent_value_ids, vec![1, 2]);
    assert_eq!(analysis.frequent_value_percentages, vec![0.8, 0.4]);
}

#[test]
fn the_frequent_values_decide_what_the_estimated_distinct_count_can_not() {
    // 10 rows, 8 names that aren't null, an estimate of 3 distinct names
    let ColumnGroup::String(column) = name_column() else { panic!("a string column") };
    let frequent = |keys: Vec<Option<&str>>, counts: Vec<i64>| {
        let ids: Vec<i64> = (1..=keys.len() as i64).collect();
        table(vec![
            ("key", a(StringArray::from(keys))),
            ("keyId", a(Int64Array::from(ids))),
            ("count", a(Int64Array::from(counts))),
        ])
    };
    let analyze = |frequent: &ResultTable, selection: Option<i64>| {
        let analysis = analyze_string_column(&stats(), &column, frequent, selection).expect("an analysis");
        (analysis.count_distinct, analysis.is_unique, analysis.has_more)
    };
    // The counts cover every row: these are all values, 2 whatever the estimate says
    assert_eq!(analyze(&frequent(vec![Some("a"), Some("b"), None], vec![5, 3, 2]), None), (2, false, false));
    // Rows are left out, the most frequent value occurs once: every value is distinct, one per name
    assert_eq!(analyze(&frequent(vec![None, Some("a"), Some("b")], vec![2, 1, 1]), None), (8, true, true));
    // Rows are left out: more than the 3 values shown, whatever the estimate says
    let shown = frequent(vec![Some("a"), Some("b"), Some("c")], vec![3, 2, 1]);
    assert_eq!(analyze(&shown, None), (4, false, true));
    // A filtered summary counts the selection, the table has at least the values that it shows
    assert_eq!(analyze(&frequent(vec![Some("a"), Some("b"), None], vec![3, 1, 1]), Some(5)), (3, false, false));
}

#[test]
fn filtered_column_aggregation_counts_the_bins_of_the_selected_rows() {
    let plan = plan_filtered_column_aggregation(&filtered_task(score_column()), &result_schema(), 11).expect("a plan");
    assert_eq!(plan.plan.query.read_sql, "SELECT * FROM \"__df_11\"\nORDER BY \"bin\" ASC NULLS LAST");
    let binned = table(vec![
        ("bin", a(Int32Array::from(vec![0, 1, 2]))),
        ("count", a(Int64Array::from(vec![3, 1, 1]))),
        ("binWidth", a(Float64Array::from(vec![4.0, 4.0, 0.0]))),
        ("binLowerBound", a(Float64Array::from(vec![1.0, 5.0, 0.0]))),
        ("binUpperBound", a(Float64Array::from(vec![5.0, 9.0, 0.0]))),
    ]);
    let result = plan.finish(&stats(), binned).expect("a summary");
    let ColumnAggregateResult::Ordinal { analysis, .. } = result.aggregate else { panic!("an ordinal summary") };
    assert_eq!(analysis.total_count, 5);
    assert_eq!(analysis.count_null, 1);
    assert_eq!(analysis.count_not_null, 9);
    assert_eq!(analysis.min_value.as_ref(), &Float64Array::from(vec![1.0]) as &dyn Array);
    assert_eq!(analysis.max_value.as_ref(), &Float64Array::from(vec![9.0]) as &dyn Array);
    assert_eq!(analysis.bin_value_counts, vec![3, 1]);
    assert_eq!(analysis.bin_percentages, vec![0.6, 0.2]);
    assert_eq!(analysis.bin_lower_bounds, vec![Some(1.0), Some(5.0)]);
    assert_eq!(analysis.bin_bounds, BinBounds::Numbers);
}

#[test]
fn column_aggregation_bins_unfiltered_values() {
    let task = filtered_task(score_column()).column;
    let schema = Schema::new(vec![Field::new("score", DataType::Date32, true)]);
    let plan = plan_column_aggregation(&task, &schema, 11).expect("a plan");
    assert!(!plan.query.sql.contains("__semi_"));
    assert!(plan.query.sql.contains("EXTRACT(EPOCH FROM t.\"score\")"));
    let binned = table(vec![
        ("bin", a(Int32Array::from(vec![0, 1, 2]))),
        ("count", a(Int64Array::from(vec![6, 2, 2]))),
        ("binLowerBound", a(Float64Array::from(vec![Some(0.0), Some(86_400_000.0), None]))),
    ]);
    let ColumnAggregateResult::Ordinal { analysis, .. } = plan.finish(&stats(), binned).expect("a summary") else {
        panic!("an ordinal summary")
    };
    assert_eq!(analysis.total_count, 10);
    assert_eq!(analysis.count_not_null, 8);
    assert_eq!(analysis.bin_percentages, vec![0.6, 0.2]);
    assert_eq!(analysis.bin_bounds, BinBounds::EpochMillis);
}

#[test]
fn column_aggregation_rejects_columns_that_cannot_be_aggregated() {
    let list = ColumnGroup::List(ListColumnGroup {
        input_field_name: "tags".into(),
        input_field_type: "List".into(),
        input_field_nullable: true,
        stats_fields: None,
        value_id_field_name: None,
    });
    let error = plan_filtered_column_aggregation(&filtered_task(list), &result_schema(), 11).expect_err("a list");
    assert!(error.to_string().contains("cannot be aggregated"));
    let mut unbinned = filtered_task(name_column());
    if let ColumnGroup::String(column) = &mut unbinned.column.column_entry {
        column.value_id_field_name = None;
    }
    assert!(plan_filtered_column_aggregation(&unbinned, &result_schema(), 11).is_err());
}

#[test]
fn column_aggregation_wraps_failures() {
    let plan = plan_filtered_column_aggregation(&filtered_task(name_column()), &result_schema(), 11).expect("a plan");
    assert!(plan
        .plan
        .query
        .failed("query failed")
        .to_string()
        .starts_with("Failed to compute filtered column aggregate"));
    // Frequent values without ids
    let frequent = table(vec![("key", a(StringArray::from(vec!["a"]))), ("count", a(Int64Array::from(vec![4])))]);
    let error = plan.finish(&stats(), frequent).expect_err("no ids");
    assert!(error.to_string().contains("Missing keyId column in frequent values table"));
}

#[test]
fn analysis_schedules_the_summaries_of_ordinal_and_string_columns() {
    let groups = vec![
        ColumnGroup::RowNumber(RowNumberColumnGroup { row_number_field_name: "_rownum".into() }),
        name_column(),
        score_column(),
        ColumnGroup::List(ListColumnGroup {
            input_field_name: "tags".into(),
            input_field_type: "List".into(),
            input_field_nullable: true,
            stats_fields: None,
            value_id_field_name: None,
        }),
    ];
    let tasks = column_aggregation_tasks(1, &groups, 12, &stats_aggregation(), AnalyzeTableOptions::default());
    assert_eq!(tasks.iter().map(|task| task.column_id).collect::<Vec<_>>(), vec![1, 2]);
    assert!(tasks.iter().all(|task| task.input_data_frame == 12));
    let none = column_aggregation_tasks(
        1,
        &groups,
        12,
        &stats_aggregation(),
        AnalyzeTableOptions { column_aggregates: false },
    );
    assert!(none.is_empty());
    assert_eq!(data_frame_table_name(12), "__df_12");
}

#[test]
fn readers_cast_booleans_and_report_missing_fields() {
    let result = table(vec![("flag", a(BooleanArray::from(vec![true, false])))]);
    assert_eq!(result.int64_values(0).expect("ints"), vec![Some(1), Some(0)]);
    assert!(result.int64_values(3).is_err());
    let stats = TableStats::read(1, &result, "missing").expect("the statistics");
    assert!(stats.row_count().is_err());
}

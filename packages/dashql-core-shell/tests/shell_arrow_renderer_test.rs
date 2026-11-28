//! Tests of rendering Arrow IPC streams as box-drawn tables, the previews of query results.

use arrow_array::builder::{Int32Builder, ListBuilder};
use arrow_array::types::Int32Type;
use arrow_array::{
    ArrayRef, BinaryArray, BooleanArray, Date32Array, Decimal128Array, DictionaryArray, Float64Array, Int32Array,
    RecordBatch, RecordBatchOptions, StringArray, StructArray, TimestampMicrosecondArray,
};
use arrow_ipc::writer::StreamWriter;
use arrow_schema::{DataType, Field, Schema};
use dashql_core::catalog::Catalog;
use dashql_core_shell::unicode::display_width;
use dashql_core_shell::{
    ArrowRenderer, EffectCompletionStatus, QueryResultTag, ShellOperation, ShellRecord, ShellRecordKind, ShellSession,
    ShellStatus,
};
use std::sync::Arc;

fn write_ipc(batch: &RecordBatch) -> Vec<u8> {
    let mut writer = StreamWriter::try_new(Vec::new(), &batch.schema()).unwrap();
    writer.write(batch).unwrap();
    writer.finish().unwrap();
    writer.into_inner().unwrap()
}

fn batch(fields: Vec<Field>, columns: Vec<ArrayRef>) -> RecordBatch {
    RecordBatch::try_new(Arc::new(Schema::new(fields)), columns).unwrap()
}

fn make_batch() -> RecordBatch {
    batch(
        vec![Field::new("name", DataType::Utf8, true), Field::new("value", DataType::Int32, true)],
        vec![
            Arc::new(StringArray::from(vec![Some("alpha"), Some("界"), None])),
            Arc::new(Int32Array::from(vec![1, 20, 300])),
        ],
    )
}

fn render(columns: u32, ipc: &[u8]) -> String {
    let output = ArrowRenderer::new(columns).render_ipc(ipc).unwrap();
    String::from_utf8(output).unwrap()
}

fn expect_lines_fit(output: &str, width: usize) {
    for line in output.split('\n') {
        assert!(display_width(line.as_bytes()) <= width, "{line}");
    }
}

#[test]
fn renders_arrow_ipc() {
    let output = render(80, &write_ipc(&make_batch()));
    assert_eq!(
        output,
        "╭───────┬───────╮\n\
         │ name  │ value │\n\
         ╞═══════╪═══════╡\n\
         │ alpha │     1 │\n\
         │ 界    │    20 │\n\
         │       │   300 │\n\
         ╰───────┴───────╯"
    );
}

#[test]
fn constrains_output_to_terminal_width() {
    let output = render(15, &write_ipc(&make_batch()));
    expect_lines_fit(&output, 15);
}

#[test]
fn gives_short_columns_only_the_space_they_need() {
    let batch = batch(
        vec![Field::new("k", DataType::Utf8, true), Field::new("description", DataType::Utf8, true)],
        vec![Arc::new(StringArray::from(vec!["x"])), Arc::new(StringArray::from(vec!["alpha beta gamma delta"]))],
    );
    let output = render(22, &write_ipc(&batch));
    expect_lines_fit(&output, 22);
    assert!(output.contains("alpha beta"), "{output}");
}

#[test]
fn wraps_at_word_boundaries() {
    let batch = batch(
        vec![Field::new("text", DataType::Utf8, true)],
        vec![Arc::new(StringArray::from(vec!["alpha beta gamma"]))],
    );
    let output = render(12, &write_ipc(&batch));
    expect_lines_fit(&output, 12);
    assert!(output.contains("│ alpha    │\n│ beta     │\n│ gamma    │"), "{output}");
}

#[test]
fn truncates_pathological_multiline_cells() {
    let value = vec!["line"; 25].join("\n");
    let batch = batch(vec![Field::new("text", DataType::Utf8, true)], vec![Arc::new(StringArray::from(vec![value]))]);
    let output = render(20, &write_ipc(&batch));
    assert!(output.contains("l..."), "{output}");
    // The row is cut, the table has fewer lines than the cell
    assert!(output.lines().count() < 25, "{output}");
}

#[test]
fn hides_columns_that_cannot_fit() {
    let batch = batch(
        vec![
            Field::new("first", DataType::Int32, true),
            Field::new("second", DataType::Int32, true),
            Field::new("third", DataType::Int32, true),
        ],
        vec![
            Arc::new(Int32Array::from(vec![1])),
            Arc::new(Int32Array::from(vec![2])),
            Arc::new(Int32Array::from(vec![3])),
        ],
    );
    let output = render(8, &write_ipc(&batch));
    expect_lines_fit(&output, 8);
    assert!(output.contains("..."), "{output}");
}

#[test]
fn escapes_terminal_control_characters() {
    let batch = batch(
        vec![Field::new("text", DataType::Utf8, true)],
        vec![Arc::new(StringArray::from(vec!["safe\x1b[31mred"]))],
    );
    let output = render(80, &write_ipc(&batch));
    assert!(!output.contains('\x1b'));
    assert!(output.contains("safe\\x1b[31mred"));
}

#[test]
fn formats_values_with_arrow_cast() {
    let ts = |tz: Option<&str>| -> ArrayRef {
        Arc::new(TimestampMicrosecondArray::from(vec![Some(1_500_000_000_123_456), None]).with_timezone_opt(tz))
    };
    let mut list = ListBuilder::new(Int32Builder::new());
    list.append_value([Some(1), None, Some(3)]);
    list.append_null();
    let tags: DictionaryArray<Int32Type> = vec![Some("red"), None].into_iter().collect();
    let point = StructArray::from(vec![
        (Arc::new(Field::new("x", DataType::Int32, true)), Arc::new(Int32Array::from(vec![1, 2])) as ArrayRef),
        (
            Arc::new(Field::new("y", DataType::Utf8, true)),
            Arc::new(StringArray::from(vec![Some("a"), None])) as ArrayRef,
        ),
    ]);
    let render_columns = |columns: Vec<(&str, ArrayRef)>| {
        let fields = columns.iter().map(|(name, column)| Field::new(*name, column.data_type().clone(), true)).collect();
        render(200, &write_ipc(&batch(fields, columns.into_iter().map(|(_, column)| column).collect())))
    };
    let output = render_columns(vec![
        ("float", Arc::new(Float64Array::from(vec![Some(0.1 + 0.2), Some(1e10)]))),
        ("dec", Arc::new(Decimal128Array::from(vec![Some(-12345), None]).with_precision_and_scale(10, 2).unwrap())),
        ("date", Arc::new(Date32Array::from(vec![Some(19000), None]))),
        ("ts", ts(None)),
        ("ts_offset", ts(Some("+02:00"))),
        // Named time zones are shown in UTC
        ("ts_named", ts(Some("Europe/Berlin"))),
    ]);
    for cell in [
        "│ 0.30000000000000004 │",
        "│       10000000000.0 │",
        " -123.45 ",
        " 2022-01-08 ",
        " 2017-07-14T02:40:00.123456 ",
        " 2017-07-14T04:40:00.123456+02:00 ",
        " 2017-07-14T02:40:00.123456Z ",
    ] {
        assert!(output.contains(cell), "{cell}: {output}");
    }
    let output = render_columns(vec![
        ("list", Arc::new(list.finish())),
        ("struct", Arc::new(point)),
        ("dict", Arc::new(tags)),
        ("bin", Arc::new(BinaryArray::from(vec![Some(&b"\x00\xff"[..]), None]))),
        ("bool", Arc::new(BooleanArray::from(vec![Some(true), None]))),
    ]);
    for cell in [" [1, null, 3] ", " {x: 1, y: a} ", " {x: 2, y: null} ", " red ", " 00ff ", " true "] {
        assert!(output.contains(cell), "{cell}: {output}");
    }
}

/// The data of a query effect with a preview: the tag, the length of the status line, the status line and the IPC
fn preview(status: &str, ipc: &[u8]) -> Vec<u8> {
    let mut data = vec![QueryResultTag::Preview as u8];
    data.extend_from_slice(&(status.len() as u32).to_le_bytes());
    data.extend_from_slice(status.as_bytes());
    data.extend_from_slice(ipc);
    data
}

fn complete_query(session: &mut ShellSession, data: &[u8]) -> ShellOperation {
    let pending = session.start_query(b"SELECT 42");
    let id = pending.effect.expect("a pending query has an effect").id;
    session.complete_effect(id, EffectCompletionStatus::Success, data)
}

#[test]
fn renders_query_previews_with_their_status_line() {
    let catalog = Catalog::new();
    let mut session = ShellSession::new(&catalog, 80);
    let complete = complete_query(&mut session, &preview("3 of 1000 rows", &write_ipc(&make_batch())));
    assert_eq!(complete.status, ShellStatus::Ok);
    let [table, status] = complete.records.as_slice() else { panic!("{:?}", complete.records) };
    assert_eq!(table.kind, ShellRecordKind::Table);
    assert!(table.text.starts_with("╭───────┬───────╮\n"), "{}", table.text);
    assert!(table.text.ends_with("╰───────┴───────╯"), "{}", table.text);
    assert_eq!(*status, ShellRecord::new(ShellRecordKind::Status, "3 of 1000 rows"));
}

#[test]
fn renders_query_previews_at_the_terminal_width() {
    let catalog = Catalog::new();
    let mut session = ShellSession::new(&catalog, 80);
    session.resize(12);
    let complete = complete_query(&mut session, &preview("", &write_ipc(&make_batch())));
    assert_eq!(complete.status, ShellStatus::Ok);
    // No status line, no record after the table
    let [table] = complete.records.as_slice() else { panic!("{:?}", complete.records) };
    expect_lines_fit(&table.text, 12);
    assert!(table.text.ends_with('╯'), "{}", table.text);
}

#[test]
fn query_status_lines_pass_through() {
    let catalog = Catalog::new();
    let mut session = ShellSession::new(&catalog, 80);
    let mut data = vec![QueryResultTag::Status as u8];
    data.extend_from_slice(b"Query completed (1 row)\r\n");
    let complete = complete_query(&mut session, &data);
    assert_eq!(complete.status, ShellStatus::Ok);
    assert_eq!(complete.records, vec![ShellRecord::new(ShellRecordKind::Status, "Query completed (1 row)")]);
}

#[test]
fn rejects_malformed_query_results() {
    let catalog = Catalog::new();
    let mut session = ShellSession::new(&catalog, 80);
    let cases: [(&[u8], &str); 5] = [
        (b"", "invalid query result"),
        (&[7], "invalid query result"),
        (&[QueryResultTag::Preview as u8, 1, 0], "invalid query result preview"),
        (&[QueryResultTag::Preview as u8, 4, 0, 0, 0, b'a'], "invalid query result preview"),
        (&[QueryResultTag::Preview as u8, 0, 0, 0, 0], "Invalid: "),
    ];
    for (data, message) in cases {
        let complete = complete_query(&mut session, data);
        assert_eq!(complete.status, ShellStatus::InternalError);
        assert!(complete.message.starts_with(message), "{}", complete.message);
    }
}

fn render_error(data: &[u8]) -> String {
    ArrowRenderer::new(80).render_ipc(data).unwrap_err()
}

#[test]
fn reports_corrupted_streams() {
    let stream = write_ipc(&make_batch());
    // The end of the schema message and the begin of the body of the record batch
    let schema_message_end = 8 + i32::from_le_bytes(stream[4..8].try_into().unwrap()) as usize;
    let metadata_length =
        i32::from_le_bytes(stream[schema_message_end + 4..schema_message_end + 8].try_into().unwrap()) as usize;
    let body_begin = schema_message_end + 8 + metadata_length;
    let mut negative_length = vec![0xff, 0xff, 0xff, 0xff];
    negative_length.extend_from_slice(&(-5i32).to_le_bytes());
    let mut short_metadata = vec![0xff, 0xff, 0xff, 0xff];
    short_metadata.extend_from_slice(&100i32.to_le_bytes());
    short_metadata.extend_from_slice(&[1, 2, 3]);
    let mut end_of_stream = vec![0xff, 0xff, 0xff, 0xff];
    end_of_stream.extend_from_slice(&0i32.to_le_bytes());
    let cases: [&[u8]; 8] = [
        &[],
        &[1, 2, 3],
        &[0xff, 0xff, 0xff, 0xff, 1, 2],
        &negative_length,
        &(-5i32).to_le_bytes(),
        &short_metadata,
        // A stream that ends in the body of its record batch
        &stream[..body_begin + 2],
        // An immediate end of stream has no schema
        &end_of_stream,
    ];
    for data in cases {
        let error = render_error(data);
        assert!(error.starts_with("Invalid: "), "{data:?}: {error}");
    }
}

#[test]
fn escapes_tabs_carriage_returns_and_control_bytes() {
    let batch = batch(
        vec![Field::new("text", DataType::Utf8, true)],
        vec![Arc::new(StringArray::from(vec!["a\tb", "line1\r\nline2", "lone\rcr", "trail\r", "bell\x07", "del\x7f"]))],
    );
    let output = render(80, &write_ipc(&batch));
    assert!(output.contains("a    b"), "{output}");
    assert!(output.contains("line1") && output.contains("line2"));
    assert!(output.contains("lone") && output.contains("cr"));
    assert!(output.contains("bell\\x07"), "{output}");
    assert!(output.contains("del\\x7f"), "{output}");
    assert!(!output.contains('\t'));
}

#[test]
fn keeps_minimum_column_widths_on_tiny_terminals() {
    let wide = batch(
        vec![
            Field::new("first_column", DataType::Utf8, true),
            Field::new("second_column", DataType::Utf8, true),
            Field::new("third_column", DataType::Utf8, true),
        ],
        vec![
            Arc::new(StringArray::from(vec!["aaaaaaaaaaaa"])),
            Arc::new(StringArray::from(vec!["bbbbbbbbbbbb"])),
            Arc::new(StringArray::from(vec!["cccccccccccc"])),
        ],
    );
    let ipc = write_ipc(&wide);
    for columns in [1, 5, 12, 20] {
        let output = render(columns, &ipc);
        assert!(!output.is_empty());
    }
}

#[test]
fn resize_changes_the_wrap_width() {
    let ipc = write_ipc(&batch(
        vec![Field::new("text", DataType::Utf8, true)],
        vec![Arc::new(StringArray::from(vec!["one two three four five six seven eight nine ten eleven twelve"]))],
    ));
    let mut renderer = ArrowRenderer::new(80);
    let wide = String::from_utf8(renderer.render_ipc(&ipc).unwrap()).unwrap();
    renderer.resize(30);
    assert_eq!(renderer.terminal_columns(), 30);
    let narrow = String::from_utf8(renderer.render_ipc(&ipc).unwrap()).unwrap();
    assert!(narrow.lines().count() > wide.lines().count());
    expect_lines_fit(&narrow, 30);
    // A width of zero is clamped
    renderer.resize(0);
    assert_eq!(renderer.terminal_columns(), 1);
}

#[test]
fn zero_column_batches_with_rows_render_no_table() {
    let rows = RecordBatch::try_new_with_options(
        Arc::new(Schema::empty()),
        vec![],
        &RecordBatchOptions::new().with_row_count(Some(2)),
    )
    .unwrap();
    // No columns, no table
    let output = String::from_utf8(ArrowRenderer::new(80).render_ipc(&write_ipc(&rows)).unwrap()).unwrap();
    assert!(!output.contains('╭') && !output.contains('│'), "{output}");
}

//! The conversion of a CSV file to Parquet in parts: workers convert byte ranges of the file in parallel, each into a
//! Parquet file of its own, see docs/design/csv_sniffer.md.
//!
//! A range starts anywhere in the file. Its reader starts at the byte before the range and drops the first record it
//! reads, the record that the range cuts: that record ends at the first line break at or after the byte before, and
//! the part before ends with it. A part ends with the first record that ends at or after the end of its range. Every
//! record so belongs to exactly one part, if each part knows whether its range starts in quoted text. A part guesses
//! that it doesn't and counts the quotes from its read start to the read start of the next part; the parity of the
//! quotes of the parts before a part tells whether the guess was right (`quote_states`), a part with a wrong guess is
//! converted again.
//!
//! A part converts with the sampled schema. A value that doesn't fit the type of its column stops the writing: the
//! part classifies the rest of its values and returns the columns widened to types that all of them fit, and is
//! converted again with them. The parts may end with different types, the query over them casts (`union_query`).

use std::sync::Arc;

use arrow_array::builder::{
    ArrayBuilder, BooleanBuilder, Date32Builder, Float64Builder, Int64Builder, StringBuilder,
    TimestampMicrosecondBuilder,
};
use arrow_array::{ArrayRef, RecordBatch};
use arrow_schema::{DataType, Field, Schema, TimeUnit};
use parquet::arrow::ArrowWriter;
use parquet::basic::Compression;
use parquet::file::properties::WriterProperties;
use serde::{Deserialize, Serialize};

use crate::hyper::{quote_identifier, quote_literal};
use crate::reader::{Record, RecordReader};
use crate::schema::{Column, ColumnState, ColumnType, DateFormat};
use crate::sniff::CsvFormat;
use crate::value;

/// The rows of a record batch
const BATCH_ROWS: usize = 64 * 1024;
/// The rows of a row group, the writer hands out the bytes of a row group when it is full
const ROW_GROUP_ROWS: usize = 256 * 1024;
/// The bytes of a range, a smaller file has fewer parts
pub const MIN_PART_BYTES: u64 = 16 * 1024 * 1024;
/// The bytes of a field that a part keeps, a longer value is cut
const MAX_FIELD_BYTES: usize = 16 * 1024 * 1024;
/// The bytes of a record that a part keeps
const MAX_RECORD_BYTES: usize = 64 * 1024 * 1024;

/// Why a part failed
#[derive(Clone, Debug, PartialEq)]
pub struct ConvertError(pub String);

impl std::fmt::Display for ConvertError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for ConvertError {}

impl From<parquet::errors::ParquetError> for ConvertError {
    fn from(e: parquet::errors::ParquetError) -> Self {
        ConvertError(e.to_string())
    }
}

impl From<arrow_schema::ArrowError> for ConvertError {
    fn from(e: arrow_schema::ArrowError) -> Self {
        ConvertError(e.to_string())
    }
}

impl From<serde_json::Error> for ConvertError {
    fn from(e: serde_json::Error) -> Self {
        ConvertError(e.to_string())
    }
}

/// A byte range of the UTF-8 of a file that a worker converts
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PartTask {
    /// The number of the part
    pub index: usize,
    /// The first byte of the range
    pub start: u64,
    /// The end of the range: the part ends with the record that ends at or after it
    pub end: u64,
    /// Does the range start in quoted text?
    pub in_quotes: bool,
}

impl PartTask {
    /// Is it the first part? It starts at the data offset, with the header.
    pub fn first(&self) -> bool {
        self.index == 0
    }

    /// Where the reader starts: a part other than the first reads the byte before its range
    pub fn read_start(&self) -> u64 {
        if self.first() {
            self.start
        } else {
            self.start.saturating_sub(1)
        }
    }

    /// The end of the bytes whose quotes the part counts: the read start of the next part
    pub fn count_end(&self) -> u64 {
        self.end.saturating_sub(1)
    }
}

/// The ranges of a file for up to `max_parts` workers, of at least `min_part_bytes` each (`MIN_PART_BYTES` by default).
/// A file that is decoded to UTF-8 is one part: the decoder reads it from its first byte.
pub fn plan_parts(format: &CsvFormat, size: u64, max_parts: usize, min_part_bytes: u64) -> Vec<PartTask> {
    let start = format.data_offset;
    if format.transcoded() || size <= start {
        return vec![PartTask { index: 0, start, end: u64::MAX, in_quotes: false }];
    }
    let bytes = size - start;
    let parts = bytes.div_ceil(min_part_bytes.max(1)).clamp(1, max_parts.max(1) as u64);
    (0..parts)
        .map(|i| PartTask {
            index: i as usize,
            start: start + bytes * i / parts,
            end: if i + 1 == parts { u64::MAX } else { start + bytes * (i + 1) / parts },
            in_quotes: false,
        })
        .collect()
}

/// Whether the ranges of the parts start in quoted text, from the quotes that each part counted
pub fn quote_states(quotes: &[u64]) -> Vec<bool> {
    let mut odd = false;
    quotes
        .iter()
        .map(|count| {
            let state = odd;
            odd ^= count % 2 == 1;
            state
        })
        .collect()
}

/// A column as the plan of a conversion names it
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanColumn {
    pub name: String,
    /// The type in SQL, e.g. `BIGINT`
    #[serde(rename = "type")]
    pub sql_type: String,
    /// The format of a date: `native`, `dmy` or `dmy_dots`
    pub date_format: String,
}

/// What a worker needs to convert a part: the format of the file and the columns. It crosses to the workers as JSON.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PartPlan {
    /// The encoding of the file, as the Encoding Standard names it
    pub encoding: String,
    pub delimiter: u8,
    pub quote: Option<u8>,
    pub has_header: bool,
    pub data_offset: u64,
    pub columns: Vec<PlanColumn>,
}

impl PartPlan {
    /// The plan of a file in a format with columns
    pub fn new(format: &CsvFormat, columns: &[Column]) -> Self {
        Self {
            encoding: format.encoding.name().to_string(),
            delimiter: format.delimiter,
            quote: format.quote,
            has_header: format.has_header,
            data_offset: format.data_offset,
            columns: columns.iter().map(plan_column).collect(),
        }
    }

    /// The plan with other columns
    pub fn with_columns(&self, columns: &[Column]) -> Self {
        Self { columns: columns.iter().map(plan_column).collect(), ..self.clone() }
    }

    /// The format of the file
    pub fn format(&self) -> Result<CsvFormat, ConvertError> {
        let encoding = encoding_rs::Encoding::for_label(self.encoding.as_bytes())
            .ok_or_else(|| ConvertError(format!("unknown encoding {}", self.encoding)))?;
        Ok(CsvFormat {
            encoding,
            bom: false,
            delimiter: self.delimiter,
            quote: self.quote,
            has_header: self.has_header,
            preamble_rows: 0,
            data_offset: self.data_offset,
            columns: self.columns.len(),
        })
    }

    /// The columns of the plan
    pub fn columns(&self) -> Result<Vec<Column>, ConvertError> {
        self.columns
            .iter()
            .map(|c| {
                let column_type = ColumnType::from_sql(&c.sql_type)
                    .ok_or_else(|| ConvertError(format!("unknown type {}", c.sql_type)))?;
                let date_format = DateFormat::from_name(&c.date_format)
                    .ok_or_else(|| ConvertError(format!("unknown date format {}", c.date_format)))?;
                Ok(Column {
                    name: c.name.clone(),
                    column_type,
                    date_format,
                    null_values: Vec::new(),
                    nulls: 0,
                    values: 0,
                })
            })
            .collect()
    }
}

fn plan_column(column: &Column) -> PlanColumn {
    PlanColumn {
        name: column.name.clone(),
        sql_type: column.column_type.sql().to_string(),
        date_format: column.date_format.name().to_string(),
    }
}

/// The Arrow type of a column
fn data_type(column: &Column) -> DataType {
    match column.column_type {
        ColumnType::Boolean => DataType::Boolean,
        ColumnType::BigInt => DataType::Int64,
        ColumnType::Double => DataType::Float64,
        ColumnType::Date => DataType::Date32,
        ColumnType::Timestamp => DataType::Timestamp(TimeUnit::Microsecond, None),
        ColumnType::TimestampTz => DataType::Timestamp(TimeUnit::Microsecond, Some("UTC".into())),
        ColumnType::Text => DataType::Utf8,
    }
}

/// The Arrow schema of the columns
pub fn arrow_schema(columns: &[Column]) -> Schema {
    Schema::new(columns.iter().map(|c| Field::new(&c.name, data_type(c), true)).collect::<Vec<_>>())
}

/// The builder of the values of a column
enum Builder {
    Boolean(BooleanBuilder),
    BigInt(Int64Builder),
    Double(Float64Builder),
    Date(Date32Builder, DateFormat),
    Timestamp(TimestampMicrosecondBuilder),
    Text(StringBuilder),
}

impl Builder {
    fn new(column: &Column) -> Self {
        match column.column_type {
            ColumnType::Boolean => Builder::Boolean(BooleanBuilder::with_capacity(BATCH_ROWS)),
            ColumnType::BigInt => Builder::BigInt(Int64Builder::with_capacity(BATCH_ROWS)),
            ColumnType::Double => Builder::Double(Float64Builder::with_capacity(BATCH_ROWS)),
            ColumnType::Date => Builder::Date(Date32Builder::with_capacity(BATCH_ROWS), column.date_format),
            ColumnType::Timestamp => Builder::Timestamp(TimestampMicrosecondBuilder::with_capacity(BATCH_ROWS)),
            ColumnType::TimestampTz => {
                Builder::Timestamp(TimestampMicrosecondBuilder::with_capacity(BATCH_ROWS).with_timezone("UTC"))
            }
            ColumnType::Text => Builder::Text(StringBuilder::with_capacity(BATCH_ROWS, BATCH_ROWS * 16)),
        }
    }

    fn append_null(&mut self) {
        match self {
            Builder::Boolean(b) => b.append_null(),
            Builder::BigInt(b) => b.append_null(),
            Builder::Double(b) => b.append_null(),
            Builder::Date(b, _) => b.append_null(),
            Builder::Timestamp(b) => b.append_null(),
            Builder::Text(b) => b.append_null(),
        }
    }

    /// Append a value that is no NULL, false if it doesn't fit the type
    fn append(&mut self, value: &[u8]) -> bool {
        match self {
            Builder::Boolean(b) => value::parse_boolean(value).map(|v| b.append_value(v)).is_some(),
            Builder::BigInt(b) => value::parse_bigint(value).map(|v| b.append_value(v)).is_some(),
            Builder::Double(b) => value::parse_double(value).map(|v| b.append_value(v)).is_some(),
            Builder::Date(b, format) => value::parse_date(value, *format).map(|v| b.append_value(v)).is_some(),
            Builder::Timestamp(b) => value::parse_timestamp(value).map(|v| b.append_value(v)).is_some(),
            Builder::Text(b) => {
                match std::str::from_utf8(value) {
                    Ok(text) => b.append_value(text),
                    Err(_) => b.append_value(String::from_utf8_lossy(value)),
                }
                true
            }
        }
    }

    fn finish(&mut self) -> ArrayRef {
        match self {
            Builder::Boolean(b) => Arc::new(b.finish()),
            Builder::BigInt(b) => Arc::new(b.finish()),
            Builder::Double(b) => Arc::new(b.finish()),
            Builder::Date(b, _) => Arc::new(b.finish()),
            Builder::Timestamp(b) => Arc::new(b.finish()),
            Builder::Text(b) => Arc::new(b.finish()),
        }
    }

    fn len(&self) -> usize {
        match self {
            Builder::Boolean(b) => b.len(),
            Builder::BigInt(b) => b.len(),
            Builder::Double(b) => b.len(),
            Builder::Date(b, _) => b.len(),
            Builder::Timestamp(b) => b.len(),
            Builder::Text(b) => b.len(),
        }
    }
}

/// Is a value of a column NULL? In a typed column an empty field and the words for a missing value, in a text column
/// an empty field that isn't quoted.
fn is_null(column: &Column, bytes: &[u8], quoted: bool) -> bool {
    if column.column_type == ColumnType::Text {
        bytes.is_empty() && !quoted
    } else {
        bytes.is_empty() || value::is_null_token(bytes)
    }
}

/// The writer of a part: record batches into a Parquet file whose finished bytes it hands out
struct PartWriter {
    schema: Arc<Schema>,
    builders: Vec<Builder>,
    writer: ArrowWriter<Vec<u8>>,
}

impl PartWriter {
    fn new(columns: &[Column]) -> Result<Self, ConvertError> {
        let schema = Arc::new(arrow_schema(columns));
        let properties = WriterProperties::builder()
            .set_compression(Compression::SNAPPY)
            .set_max_row_group_row_count(Some(ROW_GROUP_ROWS))
            .build();
        let writer = ArrowWriter::try_new(Vec::new(), schema.clone(), Some(properties))?;
        Ok(Self { schema, builders: columns.iter().map(Builder::new).collect(), writer })
    }

    /// Write the rows of the builders as a record batch
    fn flush(&mut self) -> Result<(), ConvertError> {
        if self.builders.first().is_none_or(|b| b.len() == 0) {
            return Ok(());
        }
        let arrays: Vec<ArrayRef> = self.builders.iter_mut().map(Builder::finish).collect();
        let batch = RecordBatch::try_new(self.schema.clone(), arrays)?;
        self.writer.write(&batch)?;
        Ok(())
    }

    /// The bytes of the file that the writer finished, the writer counts them and needs them no more
    fn take_bytes(&mut self) -> Vec<u8> {
        std::mem::take(self.writer.inner_mut())
    }

    /// Finish the file and return its last bytes
    fn finish(mut self) -> Result<Vec<u8>, ConvertError> {
        self.flush()?;
        Ok(self.writer.into_inner()?)
    }
}

/// What a part does with its records
enum Mode {
    /// Write them, the writer of a part that converts
    Write(Box<PartWriter>),
    /// Classify them, after a value that didn't fit its column
    Classify(Vec<ColumnState>),
}

/// What a part counts and decides of its records
struct Records {
    columns: Vec<Column>,
    mode: Mode,
    /// Drop the first record, the record that the range cuts
    drop_first: bool,
    header_pending: bool,
    /// The part ends with the record that ends at or after this position of the reader
    stop_at: u64,
    done: bool,
    rows: u64,
    ragged_rows: u64,
    truncated_values: u64,
    error: Option<ConvertError>,
}

impl Records {
    fn record(&mut self, record: &Record<'_>) {
        if self.done {
            return;
        }
        if record.end >= self.stop_at {
            self.done = true;
        }
        if std::mem::take(&mut self.drop_first) || record.blank {
            return;
        }
        if std::mem::take(&mut self.header_pending) {
            return;
        }
        self.rows += 1;
        if record.len() != self.columns.len() {
            self.ragged_rows += 1;
        }
        if let Mode::Write(writer) = &mut self.mode {
            let mut fields = record.fields();
            let mut mismatch = false;
            for (builder, column) in writer.builders.iter_mut().zip(&self.columns) {
                let Some((bytes, field)) = fields.next() else {
                    builder.append_null();
                    continue;
                };
                if field.truncated {
                    self.truncated_values += 1;
                }
                if is_null(column, bytes, field.quoted) {
                    builder.append_null();
                } else if field.truncated && column.column_type != ColumnType::Text || !builder.append(bytes) {
                    mismatch = true;
                    break;
                }
            }
            if mismatch {
                // The part is converted again with wider types, the rest of its values only decides them
                self.mode = Mode::Classify(vec![ColumnState::default(); self.columns.len()]);
            } else if writer.builders.first().is_some_and(|b| b.len() >= BATCH_ROWS) {
                if let Err(e) = writer.flush() {
                    self.error = Some(e);
                    self.done = true;
                }
                return;
            } else {
                return;
            }
        }
        if let Mode::Classify(states) = &mut self.mode {
            for ((bytes, field), state) in record.fields().zip(states.iter_mut()) {
                state.observe(bytes, field.quoted, field.truncated);
            }
        }
    }
}

/// The result of a part
#[derive(Clone, Debug, PartialEq)]
pub struct PartResult {
    /// The rows of the part, without the header
    pub rows: u64,
    /// The quotes from the read start of the part to the read start of the next part
    pub quotes: u64,
    /// Rows with another number of fields than the columns: missing fields are NULL, extra fields are dropped
    pub ragged_rows: u64,
    /// Values longer than the limit of a field, cut
    pub truncated_values: u64,
    /// The columns widened to the values of the part, if a value didn't fit: the part has no file then and is
    /// converted again with them
    pub widened: Option<Vec<Column>>,
}

/// The converter of a part. The caller pushes the bytes of the file from `input_start` on until the converter is done.
pub struct PartConverter {
    format: CsvFormat,
    task: PartTask,
    decoder: Option<encoding_rs::Decoder>,
    /// The position in the UTF-8 of the file of the next byte that the converter sees
    position: u64,
    reader: RecordReader,
    records: Records,
    quotes: Option<u64>,
}

impl PartConverter {
    /// A converter of a part of a file with its columns
    pub fn new(format: CsvFormat, columns: Vec<Column>, task: PartTask) -> Result<Self, ConvertError> {
        let read_start = task.read_start();
        let mode = Mode::Write(Box::new(PartWriter::new(&columns)?));
        let records = Records {
            columns,
            mode,
            drop_first: !task.first(),
            header_pending: task.first() && format.has_header,
            stop_at: task.end.saturating_sub(read_start),
            done: false,
            rows: 0,
            ragged_rows: 0,
            truncated_values: 0,
            error: None,
        };
        let reader = RecordReader::starting_in(format.delimiter, format.quote, task.in_quotes)
            .with_limits(MAX_FIELD_BYTES, MAX_RECORD_BYTES);
        let decoder = format.transcoded().then(|| format.encoding.new_decoder());
        let position = if decoder.is_some() { 0 } else { read_start };
        Ok(Self { format, task, decoder, position, reader, records, quotes: None })
    }

    /// The byte of the file where the caller starts to push: the read start, or the first byte of a decoded file
    pub fn input_start(&self) -> u64 {
        if self.format.transcoded() {
            0
        } else {
            self.task.read_start()
        }
    }

    /// Has the part read all of its records? The caller stops pushing then.
    pub fn done(&self) -> bool {
        self.records.done
    }

    /// Push the next bytes of the file, returns the bytes of the Parquet file that are finished
    pub fn push(&mut self, chunk: &[u8]) -> Vec<u8> {
        match self.decoder.as_mut() {
            Some(decoder) => {
                let decoded = crate::scan::decode(decoder, chunk, false);
                self.read(&decoded);
            }
            None => self.read(chunk),
        }
        self.take_bytes()
    }

    fn take_bytes(&mut self) -> Vec<u8> {
        match &mut self.records.mode {
            Mode::Write(writer) => writer.take_bytes(),
            Mode::Classify(_) => Vec::new(),
        }
    }

    /// Read bytes of the UTF-8 of the file
    fn read(&mut self, bytes: &[u8]) {
        if self.records.done {
            return;
        }
        // The bytes before the read start are no part of the part
        let read_start = self.task.read_start();
        let skip = read_start.saturating_sub(self.position).min(bytes.len() as u64) as usize;
        self.position += skip as u64;
        let mut rest = bytes.get(skip..).unwrap_or_default();
        // The quotes are counted up to the read start of the next part
        let count_end = self.task.count_end();
        if self.quotes.is_none() && self.position + rest.len() as u64 >= count_end {
            let split = count_end.saturating_sub(self.position).min(rest.len() as u64) as usize;
            let (before, after) = rest.split_at(split);
            self.read_records(before);
            self.quotes = Some(self.reader.quotes());
            rest = after;
        }
        self.read_records(rest);
    }

    fn read_records(&mut self, bytes: &[u8]) {
        self.position += bytes.len() as u64;
        let records = &mut self.records;
        self.reader.read(bytes, &mut |record| records.record(record));
    }

    /// Finish the part: the last bytes of its Parquet file and what it counted
    pub fn finish(mut self) -> Result<(Vec<u8>, PartResult), ConvertError> {
        if let Some(decoder) = self.decoder.as_mut() {
            let decoded = crate::scan::decode(decoder, &[], true);
            self.read(&decoded);
        }
        if !self.records.done {
            let records = &mut self.records;
            self.reader.finish(&mut |record| records.record(record));
        }
        if let Some(error) = self.records.error {
            return Err(error);
        }
        let quotes = self.quotes.unwrap_or_else(|| self.reader.quotes());
        let mut result = PartResult {
            rows: self.records.rows,
            quotes,
            ragged_rows: self.records.ragged_rows,
            truncated_values: self.records.truncated_values,
            widened: None,
        };
        match self.records.mode {
            Mode::Write(writer) => Ok((writer.finish()?, result)),
            Mode::Classify(states) => {
                let widened =
                    states.iter().zip(&self.records.columns).map(|(state, column)| state.widen(column)).collect();
                result.widened = Some(widened);
                Ok((Vec::new(), result))
            }
        }
    }
}

/// The query that reads the parts of a table as one: every part in the type that all parts fit, cast where its own
/// type differs. `parts` are the paths of the Parquet files with the types of their columns.
pub fn union_query(names: &[String], parts: &[(String, Vec<ColumnType>)]) -> String {
    let types: Vec<ColumnType> = (0..names.len())
        .map(|i| {
            parts
                .iter()
                .filter_map(|(_, types)| types.get(i).copied())
                .reduce(ColumnType::join)
                .unwrap_or(ColumnType::Text)
        })
        .collect();
    let selects: Vec<String> = parts
        .iter()
        .map(|(path, part_types)| {
            let columns: Vec<String> = names
                .iter()
                .zip(&types)
                .zip(part_types)
                .map(|((name, target), own)| {
                    let name = quote_identifier(name);
                    if own == target {
                        name
                    } else {
                        format!("CAST({name} AS {}) AS {name}", target.sql())
                    }
                })
                .collect();
            format!("SELECT {} FROM external({}, format => 'parquet')", columns.join(", "), quote_literal(path))
        })
        .collect();
    selects.join("\nUNION ALL\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scan::CsvScanner;
    use crate::sniff::sniff;
    use arrow_array::cast::AsArray;
    use arrow_array::types::{Date32Type, Float64Type, Int64Type, TimestampMicrosecondType};
    use arrow_array::Array;
    use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;

    /// The format and the columns of a file, scanned in full
    fn schema_of(data: &[u8]) -> (CsvFormat, Vec<Column>) {
        let format = sniff(data, true).unwrap();
        let mut scanner = CsvScanner::new(format.clone(), 0);
        scanner.push(data);
        let (schema, _) = scanner.finish();
        (format, schema.columns)
    }

    /// Convert a part like a worker, pushing the file in chunks from its input start until it is done
    fn run_part(format: &CsvFormat, columns: &[Column], task: PartTask, data: &[u8]) -> (Vec<u8>, PartResult) {
        let mut converter = PartConverter::new(format.clone(), columns.to_vec(), task).unwrap();
        let mut parquet = Vec::new();
        let mut offset = converter.input_start() as usize;
        while offset < data.len() && !converter.done() {
            let end = (offset + 7).min(data.len());
            parquet.extend(converter.push(&data[offset..end]));
            offset = end;
        }
        let (tail, result) = converter.finish().unwrap();
        parquet.extend(tail);
        (parquet, result)
    }

    /// Convert a file in parts like the coordinator: guess, check the quote states, convert the wrong guesses and the
    /// parts with wider types again. Returns the batches of every part and the widened columns.
    fn convert_in_parts(data: &[u8], tasks: Vec<PartTask>) -> (Vec<RecordBatch>, Vec<Vec<Column>>) {
        let (format, columns) = schema_of(data);
        let mut results: Vec<(Vec<u8>, PartResult, Vec<Column>)> =
            tasks.iter().map(|task| convert_widening(&format, &columns, task.clone(), data)).collect();
        let states = quote_states(&results.iter().map(|(_, r, _)| r.quotes).collect::<Vec<_>>());
        for (task, in_quotes) in tasks.iter().zip(states) {
            if task.in_quotes != in_quotes {
                let index = task.index;
                results[index] = convert_widening(&format, &columns, PartTask { in_quotes, ..task.clone() }, data);
            }
        }
        let batches = results
            .iter()
            .flat_map(|(parquet, _, _)| {
                ParquetRecordBatchReaderBuilder::try_new(bytes::Bytes::from(parquet.clone()))
                    .unwrap()
                    .build()
                    .unwrap()
                    .map(Result::unwrap)
            })
            .collect();
        (batches, results.into_iter().map(|(_, _, columns)| columns).collect())
    }

    fn convert_widening(
        format: &CsvFormat,
        columns: &[Column],
        task: PartTask,
        data: &[u8],
    ) -> (Vec<u8>, PartResult, Vec<Column>) {
        let mut columns = columns.to_vec();
        loop {
            let (parquet, result) = run_part(format, &columns, task.clone(), data);
            match result.widened.clone() {
                Some(widened) => columns = widened,
                None => return (parquet, result, columns),
            }
        }
    }

    /// The rows of batches as text, one line per row
    fn lines(batches: &[RecordBatch]) -> Vec<String> {
        let mut lines = Vec::new();
        for batch in batches {
            let text: Vec<ArrayRef> =
                batch.columns().iter().map(|c| arrow_cast::cast(c, &DataType::Utf8).unwrap()).collect();
            for row in 0..batch.num_rows() {
                let values: Vec<String> = text
                    .iter()
                    .map(|c| {
                        let c = c.as_string::<i32>();
                        if c.is_null(row) {
                            "∅".to_string()
                        } else {
                            c.value(row).to_string()
                        }
                    })
                    .collect();
                lines.push(values.join("|"));
            }
        }
        lines
    }

    /// Tasks for split points of a file
    fn tasks(format: &CsvFormat, points: &[u64]) -> Vec<PartTask> {
        let mut starts = vec![format.data_offset];
        starts.extend_from_slice(points);
        (0..starts.len())
            .map(|i| PartTask {
                index: i,
                start: starts[i],
                end: starts.get(i + 1).copied().unwrap_or(u64::MAX),
                in_quotes: false,
            })
            .collect()
    }

    /// A file with quoted line breaks, quoted delimiters, doubled quotes, CRLF and a blank line
    fn tricky_file() -> Vec<u8> {
        let mut data = b"id,text,amount\r\n".to_vec();
        for i in 0..60 {
            let text = match i % 4 {
                0 => format!("\"line {i}\r\nnext, \"\"quoted\"\" line\""),
                1 => format!("plain {i}"),
                2 => format!("\"a, b {i}\""),
                _ => String::new(),
            };
            data.extend(format!("{i},{text},{}.5\r\n", i * 3).as_bytes());
            if i == 30 {
                data.extend(b"\r\n");
            }
        }
        data
    }

    #[test]
    fn test_parts_read_every_record_once_at_any_split() {
        let data = tricky_file();
        let (format, _) = schema_of(&data);
        let (whole, _) = convert_in_parts(&data, tasks(&format, &[]));
        let expected = lines(&whole);
        assert_eq!(expected.len(), 60);
        assert_eq!(expected[0], "0|line 0\r\nnext, \"quoted\" line|0.5");
        assert_eq!(expected[3], "3|∅|9.5");
        // Every split point, also those in quoted text, in a \r\n and next to quotes
        for point in (format.data_offset + 1)..(data.len() as u64 - 1) {
            let (parts, _) = convert_in_parts(&data, tasks(&format, &[point]));
            assert_eq!(lines(&parts), expected, "split at {point}");
        }
        for points in [[100u64, 101, 102], [50, 300, 900], [17, 18, 19]] {
            let (parts, _) = convert_in_parts(&data, tasks(&format, &points));
            assert_eq!(lines(&parts), expected, "split at {points:?}");
        }
    }

    #[test]
    fn test_quote_states() {
        assert_eq!(quote_states(&[2, 1, 4, 3, 0]), vec![false, false, true, true, false]);
    }

    #[test]
    fn test_plan_parts() {
        let (format, _) = schema_of(b"a,b\n1,2\n3,4\n");
        let tasks = plan_parts(&format, 40 * 1024 * 1024, 8, MIN_PART_BYTES);
        assert_eq!(tasks.len(), 3);
        assert_eq!(tasks[0].start, format.data_offset);
        assert_eq!(tasks[1].start, tasks[0].end);
        assert_eq!(tasks[2].end, u64::MAX);
        assert_eq!(plan_parts(&format, 1000, 8, MIN_PART_BYTES).len(), 1);
        assert_eq!(plan_parts(&format, 1 << 40, 4, MIN_PART_BYTES).len(), 4);
        assert_eq!(plan_parts(&format, 1000, 8, 100).len(), 8);
    }

    #[test]
    fn test_types_and_nulls() {
        let data = b"id;name;score;ok;day;at\n\
              1;ann;1.5;yes;31/01/2024;2024-01-31T10:00:00Z\n\
              2;\"\";NA;no;01/02/2024;2024-02-01 11:30:00+01:00\n\
              3;;2;;;\n";
        let (batches, _) = convert_in_parts(data, tasks(&schema_of(data).0, &[]));
        let batch = &batches[0];
        let ids: Vec<_> = batch.column(0).as_primitive::<Int64Type>().iter().collect();
        assert_eq!(ids, vec![Some(1), Some(2), Some(3)]);
        let names: Vec<_> = batch.column(1).as_string::<i32>().iter().collect();
        assert_eq!(names, vec![Some("ann"), Some(""), None]);
        let scores: Vec<_> = batch.column(2).as_primitive::<Float64Type>().iter().collect();
        assert_eq!(scores, vec![Some(1.5), None, Some(2.0)]);
        let oks: Vec<_> = batch.column(3).as_boolean().iter().collect();
        assert_eq!(oks, vec![Some(true), Some(false), None]);
        let days: Vec<_> = batch.column(4).as_primitive::<Date32Type>().iter().collect();
        assert_eq!(days, vec![Some(19753), Some(19754), None]);
        let ats: Vec<_> = batch.column(5).as_primitive::<TimestampMicrosecondType>().iter().collect();
        let day = 19753 * 86_400_000_000i64;
        assert_eq!(ats, vec![Some(day + 36_000_000_000), Some(day + 86_400_000_000 + 37_800_000_000), None]);
    }

    #[test]
    fn test_parts_widen_their_own_columns() {
        let mut data = b"id,flag\n".to_vec();
        for i in 0..40 {
            data.extend(format!("{i},{}\n", if i % 2 == 0 { "1" } else { "0" }).as_bytes());
        }
        let sampled = data.len();
        data.extend(b"x41,yes\n42,1\n");
        let (format, columns) = schema_of(&data[..sampled]);
        assert_eq!(columns[0].column_type, ColumnType::BigInt);
        let middle = data.len() as u64 / 2;
        let tasks = tasks(&format, &[middle]);
        let results: Vec<_> =
            tasks.iter().map(|task| convert_widening(&format, &columns, task.clone(), &data)).collect();
        // The first part keeps the sampled types, the second widens both of its columns
        assert_eq!(results[0].2[0].column_type, ColumnType::BigInt);
        assert_eq!(results[1].2[0].column_type, ColumnType::Text);
        assert_eq!(results[1].2[1].column_type, ColumnType::Text);
        assert_eq!(results[0].1.rows + results[1].1.rows, 42);
        let query = union_query(
            &["id".to_string(), "flag".to_string()],
            &results
                .iter()
                .enumerate()
                .map(|(i, (_, _, columns))| (format!("p{i}.parquet"), columns.iter().map(|c| c.column_type).collect()))
                .collect::<Vec<_>>(),
        );
        assert_eq!(
            query,
            "SELECT CAST(\"id\" AS TEXT) AS \"id\", CAST(\"flag\" AS TEXT) AS \"flag\" FROM external('p0.parquet', \
             format => 'parquet')\nUNION ALL\nSELECT \"id\", \"flag\" FROM external('p1.parquet', format => 'parquet')"
        );
    }

    #[test]
    fn test_decoded_file_is_one_part() {
        let data = b"Name;Gr\xF6\xDFe\nA;1\nB;2\nC;3\n";
        let (format, columns) = schema_of(data);
        let tasks = plan_parts(&format, data.len() as u64, 8, 1);
        assert_eq!(tasks.len(), 1);
        let (parquet, result) = run_part(&format, &columns, tasks[0].clone(), data);
        assert_eq!(result.rows, 3);
        let reader = ParquetRecordBatchReaderBuilder::try_new(bytes::Bytes::from(parquet)).unwrap();
        assert_eq!(reader.schema().field(1).name(), "Größe");
    }

    #[test]
    fn test_plan_round_trip() {
        let (format, columns) = schema_of(b"a;b\n1;31/01/2024\n2;01/02/2024\n");
        let plan = PartPlan::new(&format, &columns);
        let json = serde_json::to_string(&plan).unwrap();
        let back: PartPlan = serde_json::from_str(&json).unwrap();
        assert_eq!(back.format().unwrap().delimiter, b';');
        let columns = back.columns().unwrap();
        assert_eq!((columns[1].column_type, columns[1].date_format), (ColumnType::Date, DateFormat::DayMonthYear));
    }
}

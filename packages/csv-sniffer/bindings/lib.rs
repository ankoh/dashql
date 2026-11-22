//! The wasm-bindgen API of the CSV sniffer, the module of `@akohn/csv-sniffer`. The TypeScript wrapper is `CsvSniffer`
//! in `packages/csv-sniffer/ts/index.ts`, it reads the chunks of a file and hands them over; the module decides the
//! format, the schema, the problems and the query.

use csv_sniffer::convert::{PartConverter, PartPlan, PartResult, PartTask};
use csv_sniffer::{CsvFormat, CsvScanner, CsvSchema};
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console, js_name = error)]
    fn console_error(message: &str);
}

/// Log panics to the console before the module traps. A panic aborts, the module must not be used anymore.
#[wasm_bindgen(js_name = installPanicHook)]
pub fn install_panic_hook() {
    static INSTALLED: std::sync::Once = std::sync::Once::new();
    INSTALLED.call_once(|| {
        std::panic::set_hook(Box::new(|info| console_error(&format!("csv sniffer panicked: {info}"))));
    });
}

/// The format of a CSV file
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct CsvFormatView {
    /// The encoding of the file, as the Encoding Standard names it, e.g. `UTF-8` or `windows-1252`
    pub encoding: String,
    /// Is the file decoded to UTF-8? Then `push` returns the UTF-8 and the import reads it instead of the file.
    pub transcoded: bool,
    /// Did the file start with a byte order mark?
    pub bom: bool,
    pub delimiter: String,
    /// The quote, null if fields are not quoted
    pub quote: Option<String>,
    pub has_header: bool,
    /// The lines before the data
    pub preamble_rows: usize,
    /// The bytes before the data in the UTF-8 of the file
    pub data_offset: u64,
    pub columns: usize,
}

/// A column of the schema of a CSV file
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct CsvColumnView {
    pub name: String,
    /// The type in SQL, e.g. `BIGINT`
    #[serde(rename = "type")]
    pub sql_type: String,
    /// The pattern of `to_date` of a date written with the day first, e.g. `DD/MM/YYYY`
    pub date_pattern: Option<String>,
    /// The values besides the empty field that are read as NULL, e.g. `NA`
    pub null_values: Vec<String>,
    pub nulls: u64,
    pub values: u64,
}

/// The schema of a scanned CSV file
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct CsvSchemaView {
    pub columns: Vec<CsvColumnView>,
    pub rows: u64,
    /// The end of the data in the UTF-8 of the file, before the blank lines at its end
    pub data_end: u64,
    /// The bytes of the file in UTF-8
    pub bytes: u64,
    /// The first rows, null for a NULL
    pub preview: Vec<Vec<Option<String>>>,
    /// Why Hyper may fail to read the file, as sentences
    pub problems: Vec<String>,
    /// Is the schema the one of a sample? Then the rows are those of the first bytes.
    pub sampled: bool,
}

/// A window of a file that a sample reads, in bytes of the file
#[derive(Clone, Debug, Serialize, Tsify)]
pub struct CsvWindowView {
    pub start: u64,
    pub end: u64,
}

/// A byte range of the UTF-8 of a file that a worker converts into a part
#[derive(Clone, Debug, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct CsvPartTaskView {
    /// The number of the part, the parts are in the order of the file
    pub index: usize,
    pub start: u64,
    /// The end of the range, null for the last part, which ends with the file
    pub end: Option<u64>,
    /// Does the range start in quoted text? Guessed false, until the quotes of the parts before tell
    pub in_quotes: bool,
}

impl CsvPartTaskView {
    fn task(&self) -> PartTask {
        PartTask { index: self.index, start: self.start, end: self.end.unwrap_or(u64::MAX), in_quotes: self.in_quotes }
    }
}

/// What a part counted. A part that widened its columns has no file and is converted again with `widenedPlan`.
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct CsvPartResultView {
    pub rows: u64,
    /// The quotes from the read start of the part to the read start of the next part
    pub quotes: u64,
    /// Rows with another number of fields than the columns: missing fields are NULL, extra fields are dropped
    pub ragged_rows: u64,
    /// Values longer than the limit of a field, cut
    pub truncated_values: u64,
    /// The plan with the columns widened to the values of the part, if a value didn't fit
    pub widened_plan: Option<String>,
    /// The types of the columns of the part in SQL
    pub types: Vec<String>,
}

/// A part file of a table for the query over the parts
#[derive(Clone, Debug, Serialize, Deserialize, Tsify)]
pub struct CsvPartFileView {
    /// The path of the Parquet file in Hyper
    pub path: String,
    /// The types of its columns in SQL
    pub types: Vec<String>,
}

fn format_view(format: &CsvFormat) -> CsvFormatView {
    CsvFormatView {
        encoding: format.encoding.name().to_string(),
        transcoded: format.transcoded(),
        bom: format.bom,
        delimiter: char::from(format.delimiter).to_string(),
        quote: format.quote.map(|quote| char::from(quote).to_string()),
        has_header: format.has_header,
        preamble_rows: format.preamble_rows,
        data_offset: format.data_offset,
        columns: format.columns,
    }
}

fn schema_view(schema: &CsvSchema) -> CsvSchemaView {
    CsvSchemaView {
        columns: schema
            .columns
            .iter()
            .map(|column| CsvColumnView {
                name: column.name.clone(),
                sql_type: column.column_type.sql().to_string(),
                date_pattern: column.date_format.pattern().map(str::to_string),
                null_values: column.null_values.clone(),
                nulls: column.nulls,
                values: column.values,
            })
            .collect(),
        rows: schema.rows,
        data_end: schema.data_end,
        bytes: schema.bytes,
        preview: schema.preview.clone(),
        problems: schema.problems.clone(),
        sampled: schema.sampled,
    }
}

/// The scanner of a CSV file: the format from its first bytes, then the schema from all of its bytes
#[wasm_bindgen]
pub struct CsvFileScanner {
    scanner: CsvScanner,
    schema: Option<CsvSchema>,
}

#[wasm_bindgen]
impl CsvFileScanner {
    /// Find the format of a file from its first bytes, `complete` if they are the whole file. The scanner keeps the
    /// first rows of the file as a preview.
    pub fn sniff(prefix: &[u8], complete: bool, preview_rows: usize) -> Result<CsvFileScanner, JsError> {
        let format = csv_sniffer::sniff(prefix, complete)?;
        Ok(CsvFileScanner { scanner: CsvScanner::new(format, preview_rows), schema: None })
    }

    /// The format of the file
    pub fn format(&self) -> Result<tsify::Ts<CsvFormatView>, JsError> {
        Ok(tsify::Ts::from_rust(&format_view(self.scanner.format()))?)
    }

    /// Scan the next chunk of the file, from its first byte on. Returns the UTF-8 of a file that is decoded.
    pub fn push(&mut self, chunk: &[u8]) -> Option<Vec<u8>> {
        let decoded = self.scanner.push(chunk);
        self.scanner.format().transcoded().then_some(decoded)
    }

    /// Scan the end of the file. Returns the last UTF-8 of a file that is decoded.
    pub fn finish(&mut self) -> Option<Vec<u8>> {
        let (schema, decoded) = self.scanner.finish();
        self.schema = Some(schema);
        self.scanner.format().transcoded().then_some(decoded)
    }

    /// The schema of the file, after `finish`
    pub fn schema(&self) -> Result<tsify::Ts<CsvSchemaView>, JsError> {
        let schema = self.schema.as_ref().ok_or_else(|| JsError::new("the file is not scanned"))?;
        Ok(tsify::Ts::from_rust(&schema_view(schema))?)
    }

    /// The windows that a sample of a file of a size reads besides the first bytes
    #[wasm_bindgen(js_name = sampleWindows)]
    pub fn sample_windows(&self, size: f64, prefix: f64) -> Result<Vec<tsify::Ts<CsvWindowView>>, JsError> {
        self.scanner
            .sample_windows(size as u64, prefix as u64)
            .into_iter()
            .map(|(start, end)| Ok(tsify::Ts::from_rust(&CsvWindowView { start, end })?))
            .collect()
    }

    /// Classify the records of a window of a sample
    #[wasm_bindgen(js_name = sampleWindow)]
    pub fn sample_window(&mut self, bytes: &[u8]) {
        self.scanner.sample_window(bytes);
    }

    /// Finish a sample of the first bytes (pushed) and the windows, `complete` if the first bytes are the whole file
    #[wasm_bindgen(js_name = finishSample)]
    pub fn finish_sample(&mut self, complete: bool) {
        self.schema = Some(self.scanner.finish_sample(complete));
    }

    /// The plan of the conversion of the file to Parquet in the schema, as JSON for the workers
    #[wasm_bindgen(js_name = partPlan)]
    pub fn part_plan(&self) -> Result<String, JsError> {
        let schema = self.schema.as_ref().ok_or_else(|| JsError::new("the file is not scanned"))?;
        Ok(serde_json::to_string(&PartPlan::new(self.scanner.format(), &schema.columns))?)
    }

    /// The parts of a file of a size for up to `maxParts` workers, of at least `minPartBytes` each (16 MiB if null)
    #[wasm_bindgen(js_name = planParts)]
    pub fn plan_parts(
        &self,
        size: f64,
        max_parts: usize,
        min_part_bytes: Option<f64>,
    ) -> Result<Vec<tsify::Ts<CsvPartTaskView>>, JsError> {
        let min_part_bytes = min_part_bytes.map_or(csv_sniffer::convert::MIN_PART_BYTES, |b| b as u64);
        csv_sniffer::convert::plan_parts(self.scanner.format(), size as u64, max_parts, min_part_bytes)
            .into_iter()
            .map(|task| {
                let view = CsvPartTaskView {
                    index: task.index,
                    start: task.start,
                    end: (task.end != u64::MAX).then_some(task.end),
                    in_quotes: task.in_quotes,
                };
                Ok(tsify::Ts::from_rust(&view)?)
            })
            .collect()
    }

    /// The query that reads the file with Hyper: `path` is a file from the data offset to the data end of its UTF-8
    #[wasm_bindgen(js_name = selectQuery)]
    pub fn select_query(&self, path: &str) -> Result<String, JsError> {
        let schema = self.schema.as_ref().ok_or_else(|| JsError::new("the file is not scanned"))?;
        Ok(csv_sniffer::select_query(self.scanner.format(), schema, path))
    }
}

/// Whether the ranges of the parts start in quoted text, from the quotes that each part counted
#[wasm_bindgen(js_name = quoteStates)]
pub fn quote_states(quotes: Vec<f64>) -> Vec<u8> {
    let quotes: Vec<u64> = quotes.into_iter().map(|q| q as u64).collect();
    csv_sniffer::convert::quote_states(&quotes).into_iter().map(u8::from).collect()
}

/// The query that reads the part files of a table as one, cast to the types that all parts fit
#[wasm_bindgen(js_name = unionQuery)]
pub fn union_query(names: Vec<String>, parts: Vec<tsify::Ts<CsvPartFileView>>) -> Result<String, JsError> {
    let parts = parts
        .into_iter()
        .map(|part| {
            let part = part.to_rust()?;
            let types = part
                .types
                .iter()
                .map(|t| csv_sniffer::ColumnType::from_sql(t).ok_or_else(|| JsError::new(&format!("unknown type {t}"))))
                .collect::<Result<Vec<_>, _>>()?;
            Ok((part.path, types))
        })
        .collect::<Result<Vec<_>, JsError>>()?;
    Ok(csv_sniffer::convert::union_query(&names, &parts))
}

/// The converter of a part of a CSV file into a Parquet file, in a worker
#[wasm_bindgen]
pub struct CsvPartConverter {
    converter: Option<PartConverter>,
    plan: PartPlan,
    result: Option<PartResult>,
}

#[wasm_bindgen]
impl CsvPartConverter {
    /// A converter of a part with the plan of its file
    #[wasm_bindgen(constructor)]
    pub fn new(plan: &str, task: tsify::Ts<CsvPartTaskView>) -> Result<CsvPartConverter, JsError> {
        let plan: PartPlan = serde_json::from_str(plan)?;
        let task = task.to_rust()?.task();
        let converter = PartConverter::new(plan.format()?, plan.columns()?, task).map_err(|e| JsError::new(&e.0))?;
        Ok(CsvPartConverter { converter: Some(converter), plan, result: None })
    }

    fn converter(&mut self) -> Result<&mut PartConverter, JsError> {
        self.converter.as_mut().ok_or_else(|| JsError::new("the part is finished"))
    }

    /// The byte of the file where the caller starts to push
    #[wasm_bindgen(js_name = inputStart)]
    pub fn input_start(&self) -> f64 {
        self.converter.as_ref().map_or(0.0, |c| c.input_start() as f64)
    }

    /// Has the part read all of its records? The caller stops pushing then.
    pub fn done(&self) -> bool {
        self.converter.as_ref().is_none_or(PartConverter::done)
    }

    /// Push the next bytes of the file, returns the bytes of the Parquet file that are finished
    pub fn push(&mut self, chunk: &[u8]) -> Result<Vec<u8>, JsError> {
        Ok(self.converter()?.push(chunk))
    }

    /// Finish the part, returns the last bytes of its Parquet file. `result` tells what it counted.
    pub fn finish(&mut self) -> Result<Vec<u8>, JsError> {
        let converter = self.converter.take().ok_or_else(|| JsError::new("the part is finished"))?;
        let (bytes, result) = converter.finish().map_err(|e| JsError::new(&e.0))?;
        self.result = Some(result);
        Ok(bytes)
    }

    /// What the part counted, after `finish`
    pub fn result(&self) -> Result<tsify::Ts<CsvPartResultView>, JsError> {
        let result = self.result.as_ref().ok_or_else(|| JsError::new("the part is not finished"))?;
        let widened_plan = match &result.widened {
            Some(columns) => Some(serde_json::to_string(&self.plan.with_columns(columns))?),
            None => None,
        };
        let view = CsvPartResultView {
            rows: result.rows,
            quotes: result.quotes,
            ragged_rows: result.ragged_rows,
            truncated_values: result.truncated_values,
            widened_plan,
            types: self.plan.columns.iter().map(|c| c.sql_type.clone()).collect(),
        };
        Ok(tsify::Ts::from_rust(&view)?)
    }
}

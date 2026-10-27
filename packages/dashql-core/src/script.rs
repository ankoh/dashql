//! A script: the text of an editor or a catalog entry and its latest scanned, parsed and analyzed
//! versions.
//!
//! The text is a rope indexed by Unicode code points, so that edits in the middle of large scripts
//! stay logarithmic.
//!
//! A script does not hold a reference to its catalog. Operations that read
//! the catalog take it as an argument, and dropping a script does not modify the catalog: the owner
//! drops the script from the catalog explicitly (`Catalog::drop_script`).

use crate::analyzer::{analyze, AnalyzedScript};
use crate::catalog::{Catalog, CatalogEntryId};
use crate::completion::Completion;
use crate::cursor::{ScriptCursor, ScriptView};
use crate::error::{Error, Result};
use crate::formatter::Formatter;
use dashql_buffers::formatting::FormattingConfigT;
use dashql_buffers::parser::{Node, StatementType};
use dashql_buffers::statistics::{ScriptMemoryStatisticsT, ScriptProcessingTimingsT, ScriptStatisticsT};
use dashql_buffers::status::StatusCode;
use dashql_parser::parser::{parse, ParsedScript};
use dashql_parser::scanner::{scan, ScannedScript};
use dashql_parser::span::TextSpan;
use ropey::Rope;
use std::sync::Arc;

/// The version of the script text, bumped by every edit
pub type TextVersion = u64;

/// The durations of the last scan, parse and analysis of a script in nanoseconds
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ProcessingTimings {
    /// The duration of the last scan
    pub scanner_ns: f64,
    /// The duration of the last parse
    pub parser_ns: f64,
    /// The duration of the last analysis
    pub analyzer_ns: f64,
}

/// A script text and its latest scanned, parsed and analyzed versions
pub struct Script {
    /// The catalog entry id
    catalog_entry_id: CatalogEntryId,
    /// The text
    text: Rope,
    /// The text version
    text_version: TextVersion,
    /// The latest scanned script
    pub scanned: Option<Arc<ScannedScript>>,
    /// The latest parsed script
    pub parsed: Option<Arc<ParsedScript>>,
    /// The latest analyzed script
    pub analyzed: Option<Arc<AnalyzedScript>>,
    /// The text offset of the cursor, reset by every analysis
    cursor_offset: Option<usize>,
    /// The durations of the last scan, parse and analysis
    timings: ProcessingTimings,
}

/// A stopwatch for the processing timings. `std::time::Instant` panics on wasm32-unknown-unknown,
/// where the timings stay 0 until the host provides a clock.
struct Stopwatch {
    /// The instant the stopwatch was started
    #[cfg(not(target_arch = "wasm32"))]
    start: std::time::Instant,
}

impl Stopwatch {
    fn start() -> Self {
        Self {
            #[cfg(not(target_arch = "wasm32"))]
            start: std::time::Instant::now(),
        }
    }

    /// The elapsed nanoseconds
    fn elapsed_ns(&self) -> f64 {
        #[cfg(not(target_arch = "wasm32"))]
        {
            self.start.elapsed().as_nanos() as f64
        }
        #[cfg(target_arch = "wasm32")]
        {
            0.0
        }
    }
}

impl Script {
    /// Create a script with a new entry id of the catalog
    pub fn new(catalog: &Catalog) -> Self {
        Self::with_entry_id(catalog.allocate_entry_id())
    }

    pub fn with_entry_id(catalog_entry_id: CatalogEntryId) -> Self {
        Self {
            catalog_entry_id,
            text: Rope::new(),
            text_version: 0,
            scanned: None,
            parsed: None,
            analyzed: None,
            cursor_offset: None,
            timings: ProcessingTimings::default(),
        }
    }

    pub fn catalog_entry_id(&self) -> CatalogEntryId {
        self.catalog_entry_id
    }

    pub fn text_version(&self) -> TextVersion {
        self.text_version
    }

    pub fn text(&self) -> &Rope {
        &self.text
    }

    /// Overwrite the text version. Only for tests that need versions beyond 32 bits.
    #[doc(hidden)]
    pub fn set_text_version(&mut self, text_version: TextVersion) {
        self.text_version = text_version;
    }

    /// Replace the text with an edited rope and bump the version. Unlike `replace_text`, the texts
    /// are not compared: the caller knows that the text changed.
    pub fn set_text(&mut self, text: Rope) {
        self.text = text;
        self.text_version += 1;
    }

    /// Insert text at a code point offset. Offsets past the end append.
    pub fn insert_text_at(&mut self, char_idx: usize, text: &str) {
        if text.is_empty() {
            return;
        }
        let char_idx = char_idx.min(self.text.len_chars());
        self.text.insert(char_idx, text);
        self.text_version += 1;
    }

    /// Erase a code point range
    pub fn erase_text_range(&mut self, char_idx: usize, count: usize) {
        let len = self.text.len_chars();
        if count == 0 || char_idx >= len {
            return;
        }
        let end = (char_idx + count).min(len);
        self.text.remove(char_idx..end);
        self.text_version += 1;
    }

    /// Replace the text, a no-op if the text is unchanged
    pub fn replace_text(&mut self, text: &str) {
        if text.len() == self.text.len_bytes() && self.text == text {
            return;
        }
        self.text = Rope::from_str(text);
        self.text_version += 1;
    }

    /// The text as a string
    pub fn to_text(&self) -> String {
        self.text.to_string()
    }

    /// The text of a byte span, empty if the span begins past the end. The span
    /// is clamped to the text; characters cut by the span bounds become replacement characters.
    pub fn to_text_span(&self, span: TextSpan) -> String {
        let len = self.text.len_bytes();
        let begin = span.offset as usize;
        if begin >= len {
            return String::new();
        }
        let end = (begin + span.length as usize).min(len);
        let bytes: Vec<u8> = self.text.bytes_at(begin).take(end - begin).collect();
        String::from_utf8_lossy(&bytes).into_owned()
    }

    /// Scan the script unconditionally
    pub fn scan(&mut self) {
        let watch = Stopwatch::start();
        let text = self.text.to_string();
        self.scanned = Some(Arc::new(scan(&text, self.text_version, self.catalog_entry_id)));
        self.timings.scanner_ns = watch.elapsed_ns();
    }

    /// Parse the script unconditionally, scanning first if the scan is missing or outdated
    pub fn parse(&mut self) {
        if self.scanned.as_ref().is_none_or(|s| s.text_version != self.text_version) {
            self.scan();
        }
        // The parser registers keyword names and the replacements of obfuscated literals in a copy
        // of the scanned script (in place if it is not shared), which becomes the scanned script
        let watch = Stopwatch::start();
        let scanned = self.scanned.take().unwrap();
        let parsed = parse(scanned);
        self.scanned = Some(parsed.scanned.clone());
        self.parsed = Some(Arc::new(parsed));
        self.timings.parser_ns = watch.elapsed_ns();
    }

    /// Scan and parse if the text changed
    fn parse_if_outdated(&mut self) {
        if self.scanned.as_ref().is_none_or(|s| s.text_version != self.text_version) {
            self.scan();
        }
        let current = match (&self.parsed, &self.scanned) {
            (Some(p), Some(s)) => Arc::ptr_eq(&p.scanned, s),
            _ => false,
        };
        if !current {
            self.parse();
        }
    }

    /// Parse if the parsed script is missing or was parsed from another text version (the check of
    /// `statement_text`, `rewrite_dashboard` and `compute_signature`)
    fn parse_if_text_outdated(&mut self) {
        if self.parsed.as_ref().is_none_or(|p| p.scanned.text_version != self.text_version) {
            self.parse();
        }
    }

    /// Analyze the script
    pub fn analyze(&mut self, catalog: &Catalog, parse_if_outdated: bool) -> Result<()> {
        if parse_if_outdated {
            self.parse_if_outdated();
        }
        let Some(parsed) = self.parsed.clone() else {
            return Err(Error::status(StatusCode::SCRIPT_NOT_PARSED));
        };
        self.cursor_offset = None;
        let watch = Stopwatch::start();
        self.analyzed = Some(Arc::new(analyze(parsed, catalog)?));
        self.timings.analyzer_ns = watch.elapsed_ns();
        Ok(())
    }

    /// The parts of the script that a cursor reads
    pub fn view<'a>(&'a self, catalog: &'a Catalog) -> ScriptView<'a> {
        ScriptView {
            scanned: self.scanned.as_ref(),
            parsed: self.parsed.as_ref(),
            analyzed: self.analyzed.as_ref(),
            catalog,
        }
    }

    /// Move the cursor to a text offset
    pub fn move_cursor<'a>(&'a mut self, catalog: &'a Catalog, text_offset: usize) -> ScriptCursor<'a> {
        self.cursor_offset = Some(text_offset);
        ScriptCursor::place(self.view(catalog), text_offset)
    }

    /// The text offset of the cursor, if it was moved since the last analysis
    pub fn cursor_offset(&self) -> Option<usize> {
        self.cursor_offset
    }

    /// Move or reset the cursor without placing it. The cursor is placed when it is read with
    /// `cursor`.
    pub fn set_cursor_offset(&mut self, text_offset: Option<usize>) {
        self.cursor_offset = text_offset;
    }

    /// The cursor, if it was moved since the last analysis
    pub fn cursor<'a>(&'a self, catalog: &'a Catalog) -> Option<ScriptCursor<'a>> {
        self.cursor_offset.map(|offset| ScriptCursor::place(self.view(catalog), offset))
    }

    /// Complete at the cursor
    pub fn complete_at_cursor<'c, 'a>(cursor: &'c ScriptCursor<'a>, limit: usize) -> Result<Completion<'c, 'a>> {
        if cursor.scanner_location.is_none() {
            return Err(Error::status(StatusCode::COMPLETION_MISSES_SCANNER_TOKEN));
        }
        Ok(Completion::compute(cursor, limit))
    }

    /// Compute the signature
    pub fn compute_signature(&mut self, parse_if_outdated: bool) -> Result<String> {
        if parse_if_outdated {
            self.parse_if_text_outdated();
        }
        let parsed = self.parsed.as_ref().ok_or_else(|| Error::status(StatusCode::SCRIPT_NOT_PARSED))?;
        crate::signature::compute_signature(parsed)
    }

    /// The text of the first statement without its separator or surrounding trivia
    pub fn statement_text(&mut self, parse_if_outdated: bool) -> Result<String> {
        if parse_if_outdated {
            self.parse_if_text_outdated();
        }
        let parsed = self.parsed.as_ref().ok_or_else(|| Error::status(StatusCode::SCRIPT_NOT_PARSED))?;
        if parsed.statements.is_empty() {
            return Ok(String::new());
        }
        let span = parsed.associate_descriptions()[0].statement_span;
        Ok(self.to_text_span(span))
    }

    /// Rewrite the dashboard placement of the terminal query, the args of its `@vis card` tag. A query
    /// without a card gets one in front of it.
    ///
    /// The spans of the parsed script are applied to the current text, which differs from the parsed
    /// text if the script was edited and `parse_if_outdated` is false (see docs/design/core_quirks.md).
    /// Bytes are spliced, so a span that cuts a character leaves replacement characters.
    pub fn rewrite_dashboard(
        &mut self,
        mut row: Option<i32>,
        mut column: Option<i32>,
        width: i32,
        height: i32,
        parse_if_outdated: bool,
    ) -> Result<String> {
        if parse_if_outdated {
            self.parse_if_text_outdated();
        }
        let not_parsed = || Error::status(StatusCode::SCRIPT_NOT_PARSED);
        let parsed = self.parsed.as_ref().ok_or_else(not_parsed)?;
        if !parsed.errors.is_empty() || parsed.statements.is_empty() {
            return Err(not_parsed());
        }
        let statement_id = parsed.statements.len() - 1;
        if parsed.statements[statement_id].statement_type != StatementType::SELECT
            || !crate::analyzer::has_vis_tags(parsed, statement_id)
        {
            return Err(not_parsed());
        }

        let width = width.clamp(1, 12);
        let height = height.max(1);
        if row.is_some_and(|r| r < 0) {
            row = None;
        }
        if let Some(c) = column.as_mut() {
            *c = (*c).clamp(0, 12 - width);
        }
        let mut card = String::from("card");
        if let Some(row) = row {
            card.push_str(&format!(" row={row}"));
        }
        if let Some(column) = column {
            card.push_str(&format!(" column={column}"));
        }
        card.push_str(&format!(" width={width} height={height}"));

        let mut source = self.text.to_string().into_bytes();
        let (begin, end, replacement) = match crate::analyzer::vis_card_line(parsed, statement_id) {
            Some(line) => (line.offset as usize, line.end() as usize, card),
            None => {
                let at = parsed.associate_descriptions()[statement_id].statement_span.offset as usize;
                (at, at, format!("/* @vis {card} */\n"))
            }
        };
        if begin > source.len() {
            // std::string::replace throws std::out_of_range
            return Err(Error::invalid_argument("basic_string::replace: position out of range"));
        }
        source.splice(begin..end.min(source.len()), replacement.bytes());
        Ok(String::from_utf8_lossy(&source).into_owned())
    }

    /// Scan and parse if requested and outdated, then return the parsed script to format
    fn parsed_for_formatting(&mut self, parse_if_outdated: bool) -> Result<&Arc<ParsedScript>> {
        if parse_if_outdated {
            self.parse_if_outdated();
        }
        self.parsed.as_ref().ok_or_else(|| Error::status(StatusCode::SCRIPT_NOT_PARSED))
    }

    /// Format the script
    pub fn format(&mut self, config: &FormattingConfigT, parse_if_outdated: bool) -> Result<String> {
        let parsed = self.parsed_for_formatting(parse_if_outdated)?;
        Ok(Formatter::new(parsed).format(config))
    }

    /// Format the script and return the raw bytes, which may contain partial UTF-8 sequences where
    /// comments were wrapped (see `Formatter::format_bytes`)
    pub fn format_bytes(&mut self, config: &FormattingConfigT, parse_if_outdated: bool) -> Result<Vec<u8>> {
        let parsed = self.parsed_for_formatting(parse_if_outdated)?;
        Ok(Formatter::new(parsed).format_bytes(config))
    }

    /// The nodes that formatting could not represent
    pub fn unformattable_nodes(&mut self, config: &FormattingConfigT, parse_if_outdated: bool) -> Result<Vec<u32>> {
        let parsed = self.parsed_for_formatting(parse_if_outdated)?;
        let mut formatter = Formatter::new(parsed);
        formatter.format_bytes(config);
        Ok(formatter.unformattable_nodes())
    }

    /// Can formatting represent every node and does the script parse without errors?
    ///
    /// Statements with syntax errors are copied as written, which is not formatting them.
    pub fn is_fully_formattable(&mut self, config: &FormattingConfigT, parse_if_outdated: bool) -> Result<bool> {
        let parsed = self.parsed_for_formatting(parse_if_outdated)?;
        let mut formatter = Formatter::new(parsed);
        formatter.format_bytes(config);
        Ok(formatter.is_fully_formatted())
    }

    /// The durations of the last scan, parse and analysis in nanoseconds
    pub fn timings(&self) -> ProcessingTimings {
        self.timings
    }

    /// The memory statistics.
    ///
    /// They describe the latest analyzed script and the parsed and scanned script it was analyzed
    /// from, and are 0 except for the rope size before the first analysis. The rope and input sizes
    /// are text lengths, the AST size is the node count times the node size, and the name index size
    /// is its entry count. The others measure the Rust data structures:
    /// - `scanner_symbol_bytes` is the size of the symbol vector.
    /// - `scanner_name_dictionary_bytes` counts the registered names and their texts.
    /// - `analyzer_description_bytes` multiplies the element counts of the declarations, references,
    ///   expressions and scopes with the sizes of their types.
    /// - `analyzer_name_index_bytes` is the size of the suffix vector.
    pub fn memory_statistics(&self) -> ScriptMemoryStatisticsT {
        use std::mem::size_of;
        let mut memory = ScriptMemoryStatisticsT::default();
        memory.rope_bytes = self.text.len_bytes() as u32;
        let Some(analyzed) = self.analyzed.as_ref() else {
            return memory;
        };
        let entry = &analyzed.entry;
        let table_column_bytes: usize = entry
            .table_declarations
            .iter()
            .map(|t| t.table_columns.len() * size_of::<crate::catalog::TableColumn>())
            .sum();
        let description_bytes = entry.database_references.len() * size_of::<crate::catalog::DatabaseReference>()
            + entry.schema_references.len() * size_of::<crate::catalog::SchemaReference>()
            + entry.table_declarations.len() * size_of::<crate::catalog::TableDeclaration>()
            + table_column_bytes
            + analyzed.table_references.len() * size_of::<crate::analyzer::TableReference>()
            + analyzed.expressions.len() * size_of::<crate::analyzer::Expression>()
            + analyzed.function_arguments.len() * size_of::<crate::analyzer::FunctionArgument>()
            + analyzed.name_scopes.len() * size_of::<crate::analyzer::NameScope>();
        let latest = &mut memory.latest_script;
        latest.analyzer_description_bytes = description_bytes as u32;
        let index = analyzed.name_search_index();
        if index.is_built() {
            latest.analyzer_name_index_size = index.len() as u32;
            latest.analyzer_name_index_bytes = index.byte_size() as u32;
        }
        let parsed = &analyzed.parsed;
        latest.parser_ast_bytes = (parsed.nodes.len() * size_of::<Node>()) as u32;
        let scanned = &parsed.scanned;
        latest.scanner_input_bytes = scanned.text.len() as u32;
        latest.scanner_symbol_bytes = (scanned.symbols.len() * size_of::<dashql_parser::scanner::Symbol>()) as u32;
        let name_bytes: usize = scanned
            .names
            .iter()
            .map(|n| n.text.len() + size_of::<dashql_parser::names::RegisteredName>())
            .sum();
        latest.scanner_name_dictionary_bytes = name_bytes as u32;
        memory
    }

    /// The processing statistics
    pub fn statistics(&self) -> ScriptStatisticsT {
        let mut statistics = ScriptStatisticsT::default();
        let mut timings = ScriptProcessingTimingsT::default();
        timings.scanner_last_elapsed = self.timings.scanner_ns;
        timings.parser_last_elapsed = self.timings.parser_ns;
        timings.analyzer_last_elapsed = self.timings.analyzer_ns;
        statistics.timings = Some(timings);
        statistics.memory = Some(self.memory_statistics());
        statistics
    }
}

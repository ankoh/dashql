//! Renders Arrow IPC results as box-drawn tables.
//!
//! Cell values are formatted by arrow-cast (`ArrayFormatter`): floats with their shortest round-trip digits,
//! temporal values in ISO 8601, binaries in hex, nested values like `[1, 2]` or `{a: 1}`.

use super::unicode::display_width;
use arrow_array::timezone::Tz;
use arrow_array::{make_array, Array, ArrayRef, RecordBatch};
use arrow_cast::display::{ArrayFormatter, FormatOptions};
use arrow_schema::{DataType, Schema};
use std::fmt::Write;
use std::io::Cursor;
use unicode_segmentation::UnicodeSegmentation;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Alignment {
    Left,
    Right,
}

const CELL_PADDING: usize = 2;
const MIN_CONTENT_WIDTH: usize = 1;
const MAX_ROW_HEIGHT: usize = 20;
const TRUNCATION_MARKER: &str = "...";
const NO_RESULTS_MESSAGE: &str = "No results";
/// Null cells stay empty, nulls inside nested values print as `null`
const FORMAT_OPTIONS: FormatOptions<'static> = FormatOptions::new().with_null("null");

/// A cell of a rendered table
struct Cell {
    /// The escaped cell text
    text: String,
    /// The horizontal alignment of the text
    alignment: Alignment,
}

/// A result table with formatted cells
struct Table {
    /// The escaped column names
    headers: Vec<String>,
    /// The alignment of every column, right for numeric and boolean columns
    alignments: Vec<Alignment>,
    /// The rows of cells
    rows: Vec<Vec<Cell>>,
}

/// Make cell text safe for a terminal
fn escape_cell_text(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\n' => output.push('\n'),
            '\r' if chars.peek() != Some(&'\n') => output.push('\n'),
            '\r' => {}
            '\t' => output.push_str("    "),
            c if c < '\x20' || c == '\x7f' => {
                let _ = write!(output, "\\x{:02x}", u32::from(c));
            }
            c => output.push(c),
        }
    }
    output
}

/// Numbers and booleans are right-aligned
fn is_right_aligned(data_type: &DataType) -> bool {
    data_type.is_numeric() || *data_type == DataType::Boolean
}

fn create_table(schema: &Schema) -> Table {
    Table {
        headers: schema.fields().iter().map(|f| escape_cell_text(f.name())).collect(),
        alignments: schema
            .fields()
            .iter()
            .map(|f| if is_right_aligned(f.data_type()) { Alignment::Right } else { Alignment::Left })
            .collect(),
        rows: Vec::new(),
    }
}

/// arrow-cast resolves named time zones only with chrono-tz, which the shell does not link. Timestamp columns
/// with such a time zone are shown in UTC.
fn displayable(column: &ArrayRef) -> ArrayRef {
    match column.data_type() {
        DataType::Timestamp(unit, Some(tz)) if tz.parse::<Tz>().is_err() => {
            let utc = DataType::Timestamp(*unit, Some("+00:00".into()));
            // Timestamps keep their layout in UTC, a column that can't be rebuilt shows as it is
            column.to_data().into_builder().data_type(utc).build().map(make_array).unwrap_or_else(|_| column.clone())
        }
        _ => column.clone(),
    }
}

fn append_batch(table: &mut Table, batch: &RecordBatch) {
    let columns: Vec<ArrayRef> = batch.columns().iter().map(displayable).collect();
    let nulls: Vec<_> = columns.iter().map(|column| column.logical_nulls()).collect();
    // A column that arrow-cast cannot format shows its type
    let formatters: Vec<_> =
        columns.iter().map(|column| ArrayFormatter::try_new(column.as_ref(), &FORMAT_OPTIONS).ok()).collect();
    let mut text = String::new();
    for row in 0..batch.num_rows() {
        let mut cells = Vec::with_capacity(columns.len());
        for (((column, nulls), formatter), alignment) in
            columns.iter().zip(&nulls).zip(&formatters).zip(&table.alignments)
        {
            text.clear();
            if !nulls.as_ref().is_some_and(|nulls| nulls.is_null(row)) {
                let _ = match formatter {
                    Some(formatter) => write!(text, "{}", formatter.value(row)),
                    None => write!(text, "{}", column.data_type()),
                };
            }
            cells.push(Cell { text: escape_cell_text(&text), alignment: *alignment });
        }
        table.rows.push(cells);
    }
}

/// Read an Arrow IPC stream. Errors are the arrow-rs error after `Invalid: `.
fn read_ipc(data: &[u8]) -> Result<Table, String> {
    let invalid = |e: arrow_schema::ArrowError| format!("Invalid: {e}");
    let reader = arrow_ipc::reader::StreamReader::try_new(Cursor::new(data), None).map_err(invalid)?;
    let mut table = create_table(&reader.schema());
    for batch in reader {
        append_batch(&mut table, &batch.map_err(invalid)?);
    }
    Ok(table)
}

/// A grapheme cluster of a text
struct Grapheme {
    /// The byte offset of the cluster
    begin: usize,
    /// The byte offset after the cluster
    end: usize,
    /// The display width in terminal columns
    width: usize,
    /// Is the cluster one character of ASCII whitespace?
    space: bool,
}

/// ASCII whitespace, including vertical tab and form feed
fn is_space(c: u8) -> bool {
    matches!(c, b' ' | b'\t' | b'\n' | 0x0b | 0x0c | b'\r')
}

fn text_graphemes(text: &str) -> Vec<Grapheme> {
    text.grapheme_indices(true)
        .map(|(begin, cluster)| Grapheme {
            begin,
            end: begin + cluster.len(),
            width: display_width(cluster),
            space: matches!(cluster.as_bytes(), [c] if is_space(*c)),
        })
        .collect()
}

/// The text in a range of byte offsets at cluster boundaries, empty for a range outside of it
fn text_in(text: &str, begin: usize, end: usize) -> &str {
    text.get(begin..end).unwrap_or_default()
}

/// Cut a text to a width and append "..."
fn mark_truncated(text: &str, width: usize) -> String {
    let marker_width = width.min(TRUNCATION_MARKER.len());
    let content_width = width - marker_width;
    let mut end = 0;
    let mut rendered = 0;
    for grapheme in text_graphemes(text) {
        if rendered + grapheme.width > content_width {
            break;
        }
        rendered += grapheme.width;
        end = grapheme.end;
    }
    let mut output = text_in(text, 0, end).to_string();
    output.push_str(TRUNCATION_MARKER.get(..marker_width).unwrap_or_default());
    output
}

fn wrap_line(text: &str, width: usize) -> Vec<String> {
    let width = width.max(1);
    if text.is_empty() {
        return vec![String::new()];
    }
    let graphemes = text_graphemes(text);
    let mut lines = Vec::new();
    let mut begin = 0;
    while begin < graphemes.len() {
        let mut end = begin;
        let mut rendered: usize = 0;
        let mut whitespace = None;
        while let Some(grapheme) = graphemes.get(end) {
            if rendered != 0 && rendered.saturating_add(grapheme.width) > width {
                break;
            }
            rendered += grapheme.width;
            if grapheme.space {
                whitespace = Some(end);
            }
            end += 1;
        }
        if let Some(whitespace) = whitespace {
            if end < graphemes.len() && whitespace >= begin {
                end = whitespace + 1;
            }
        }
        let line = graphemes.get(begin..end).unwrap_or_default();
        let content = match line.iter().rposition(|grapheme| !grapheme.space) {
            Some(last) => line.get(..=last).unwrap_or_default(),
            None => &[],
        };
        match (content.first(), content.last()) {
            (Some(first), Some(last)) => lines.push(text_in(text, first.begin, last.end).to_string()),
            _ => lines.push(String::new()),
        }
        begin = end;
    }
    lines
}

fn wrap_text(text: &str, width: usize) -> Vec<String> {
    text.split('\n').flat_map(|line| wrap_line(line, width)).collect()
}

fn frame_width(column_count: usize) -> usize {
    if column_count == 0 {
        0
    } else {
        (CELL_PADDING + 1) * column_count + 1
    }
}

fn visible_column_count(mut column_count: usize, terminal_columns: usize) -> usize {
    while column_count > 1 && frame_width(column_count) + column_count * MIN_CONTENT_WIDTH > terminal_columns {
        column_count -= 1;
    }
    column_count
}

fn resolve_column_widths(table: &Table, terminal_columns: usize) -> Vec<usize> {
    let column_count = visible_column_count(table.headers.len(), terminal_columns);
    let mut widths: Vec<usize> =
        table.headers.iter().take(column_count).map(|header| display_width(header).max(1)).collect();
    for row in &table.rows {
        for (width, cell) in widths.iter_mut().zip(row) {
            for line in wrap_text(&cell.text, usize::MAX) {
                *width = (*width).max(display_width(&line));
            }
        }
    }
    if column_count == 0 {
        return widths;
    }
    let frame = frame_width(column_count);
    let available = if terminal_columns > frame { terminal_columns - frame } else { column_count };
    if available < column_count {
        return vec![MIN_CONTENT_WIDTH; column_count];
    }
    // Only the initial total is compared with the available width, the loop does not check it again
    let total: usize = widths.iter().sum();
    if total <= available {
        return widths;
    }
    let mut fixed = vec![false; column_count];
    loop {
        let mut remaining_width = available;
        let mut remaining_columns = 0;
        for (width, fixed) in widths.iter().zip(&fixed) {
            if *fixed {
                remaining_width = remaining_width.saturating_sub(*width);
            } else {
                remaining_columns += 1;
            }
        }
        if remaining_columns == 0 {
            break;
        }
        let share = MIN_CONTENT_WIDTH.max(remaining_width / remaining_columns);
        let mut found_small = false;
        for (width, fixed) in widths.iter().zip(fixed.iter_mut()) {
            if !*fixed && *width <= share {
                *fixed = true;
                found_small = true;
            }
        }
        if found_small {
            continue;
        }
        let base = MIN_CONTENT_WIDTH.max(remaining_width / remaining_columns);
        let mut excess = remaining_width.saturating_sub(base * remaining_columns);
        for (width, fixed) in widths.iter_mut().zip(&fixed) {
            if !*fixed {
                *width = base + if excess > 0 { 1 } else { 0 };
                excess = excess.saturating_sub(1);
            }
        }
        break;
    }
    widths
}

fn append_rule(output: &mut String, left: &str, middle: &str, right: &str, fill: &str, widths: &[usize]) {
    output.push_str(left);
    for (column, width) in widths.iter().enumerate() {
        if column != 0 {
            output.push_str(middle);
        }
        output.push_str(&fill.repeat(width + 2));
    }
    output.push_str(right);
    output.push('\n');
}

fn append_cell(output: &mut String, text: &str, width: usize, alignment: Alignment) {
    let padding = " ".repeat(width.saturating_sub(display_width(text)));
    if alignment == Alignment::Right {
        output.push_str(&padding);
    }
    output.push_str(text);
    if alignment == Alignment::Left {
        output.push_str(&padding);
    }
}

fn append_row(output: &mut String, cells: &[Cell], widths: &[usize], separator: &str) {
    let mut wrapped = Vec::with_capacity(widths.len());
    let mut row_height = 1;
    for (column, &width) in widths.iter().enumerate() {
        let text = cells.get(column).map_or("", |c| &c.text);
        let mut lines = wrap_text(text, width);
        if lines.len() > MAX_ROW_HEIGHT {
            lines.truncate(MAX_ROW_HEIGHT);
            if let Some(last) = lines.last_mut() {
                *last = mark_truncated(last, width);
            }
        }
        row_height = row_height.max(lines.len());
        wrapped.push(lines);
    }
    for line in 0..row_height {
        output.push_str("│ ");
        for (column, (&width, lines)) in widths.iter().zip(&wrapped).enumerate() {
            if column != 0 {
                output.push(' ');
                output.push_str(separator);
                output.push(' ');
            }
            let text = lines.get(line).map_or("", String::as_str);
            let alignment = cells.get(column).map_or(Alignment::Left, |c| c.alignment);
            append_cell(output, text, width, alignment);
        }
        output.push_str(" │\n");
    }
}

fn render_table(table: &Table, terminal_columns: usize) -> String {
    if table.headers.is_empty() {
        return NO_RESULTS_MESSAGE.to_string();
    }
    let widths = resolve_column_widths(table, terminal_columns);
    let mut output = String::new();
    append_rule(&mut output, "╭", "┬", "╮", "─", &widths);
    // The header of the last visible column is marked when columns are left out
    let hides_columns = widths.len() < table.headers.len();
    let headers: Vec<Cell> = table
        .headers
        .iter()
        .zip(&widths)
        .enumerate()
        .map(|(column, (header, &width))| {
            let text = if hides_columns && column + 1 == widths.len() {
                mark_truncated(header, width)
            } else {
                header.clone()
            };
            Cell { text, alignment: Alignment::Left }
        })
        .collect();
    append_row(&mut output, &headers, &widths, "│");
    append_rule(&mut output, "╞", "╪", "╡", "═", &widths);
    for row in &table.rows {
        append_row(&mut output, row, &widths, "│");
    }
    append_rule(&mut output, "╰", "┴", "╯", "─", &widths);
    output.pop();
    output
}

/// Renders Arrow IPC results for a terminal width
#[derive(Clone, Debug)]
pub struct ArrowRenderer {
    /// The terminal width in columns, at least 1
    terminal_columns: u32,
}

impl ArrowRenderer {
    pub fn new(terminal_columns: u32) -> Self {
        Self { terminal_columns: terminal_columns.max(1) }
    }

    pub fn resize(&mut self, terminal_columns: u32) {
        self.terminal_columns = terminal_columns.max(1);
    }

    pub fn terminal_columns(&self) -> u32 {
        self.terminal_columns
    }

    /// Render an Arrow IPC stream. Errors are Arrow error texts.
    pub fn render_ipc(&self, data: &[u8]) -> Result<String, String> {
        let table = read_ipc(data)?;
        Ok(render_table(&table, self.terminal_columns as usize))
    }
}

impl Default for ArrowRenderer {
    fn default() -> Self {
        Self::new(100)
    }
}

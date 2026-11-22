//! The schema of a CSV file: a type per column that every value of the column can be read as.

use crate::value::{self, ValueClass};

/// The type of a column, as Hyper reads it
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ColumnType {
    Boolean,
    BigInt,
    Double,
    Date,
    Timestamp,
    TimestampTz,
    Text,
}

impl ColumnType {
    /// The type in SQL
    pub fn sql(self) -> &'static str {
        match self {
            ColumnType::Boolean => "BOOLEAN",
            ColumnType::BigInt => "BIGINT",
            ColumnType::Double => "DOUBLE PRECISION",
            ColumnType::Date => "DATE",
            ColumnType::Timestamp => "TIMESTAMP",
            ColumnType::TimestampTz => "TIMESTAMPTZ",
            ColumnType::Text => "TEXT",
        }
    }
}

/// How the values of a date column are written
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DateFormat {
    /// As Hyper reads dates: `YYYY-MM-DD`, `YYYY/MM/DD` or `M/D/YYYY`
    Native,
    /// `D/M/YYYY`, read with `to_date(value, 'DD/MM/YYYY')`
    DayMonthYear,
    /// `D.M.YYYY`, read with `to_date(value, 'DD.MM.YYYY')`
    DayMonthYearDots,
}

impl DateFormat {
    /// The pattern of `to_date`, none for a native date
    pub fn pattern(self) -> Option<&'static str> {
        match self {
            DateFormat::Native => None,
            DateFormat::DayMonthYear => Some("DD/MM/YYYY"),
            DateFormat::DayMonthYearDots => Some("DD.MM.YYYY"),
        }
    }
}

/// A column of the schema
#[derive(Clone, Debug, PartialEq)]
pub struct Column {
    /// The name, unique among the columns
    pub name: String,
    pub column_type: ColumnType,
    /// How the dates of a date column are written
    pub date_format: DateFormat,
    /// The values that are read as NULL besides an empty field: words like `NA` and the quoted empty string `""`,
    /// which Hyper reads as an empty string, most frequent first. A text column has none, these are its text.
    pub null_values: Vec<String>,
    /// The values that are NULL
    pub nulls: u64,
    /// The values that are not
    pub values: u64,
}

impl Column {
    /// Must Hyper read the column as text and the import cast it? A typed column with NULL words, quoted empty
    /// strings or dates that Hyper doesn't read is read as text.
    pub fn read_as_text(&self) -> bool {
        self.column_type != ColumnType::Text && (!self.null_values.is_empty() || self.date_format != DateFormat::Native)
    }
}

/// The values of a column that the scanner saw
#[derive(Clone, Debug)]
pub struct ColumnState {
    /// The types that every value can be read as
    types: u16,
    /// Has a timestamp a zone?
    zoned: bool,
    /// The values that are no NULL
    values: u64,
    /// The empty fields, NULL in Hyper
    empties: u64,
    /// The empty quoted fields, an empty string in Hyper
    quoted_empties: u64,
    /// The NULL words and their counts
    null_tokens: Vec<(Vec<u8>, u64)>,
}

impl Default for ColumnState {
    fn default() -> Self {
        Self { types: value::ALL, zoned: false, values: 0, empties: 0, quoted_empties: 0, null_tokens: Vec::new() }
    }
}

impl ColumnState {
    /// See a value of the column
    pub fn observe(&mut self, value: &[u8], quoted: bool, truncated: bool) {
        if truncated {
            self.types = 0;
            self.values += 1;
            return;
        }
        if value.is_empty() {
            if quoted {
                self.quoted_empties += 1;
            } else {
                self.empties += 1;
            }
            return;
        }
        if value::is_null_token(value) {
            match self.null_tokens.iter_mut().find(|(token, _)| token == value) {
                Some((_, count)) => *count += 1,
                None => self.null_tokens.push((value.to_vec(), 1)),
            }
            return;
        }
        self.values += 1;
        // A text column stays text, its values need no look
        if self.types != 0 {
            let ValueClass { types, zoned } = value::classify(value);
            self.types &= types;
            self.zoned |= zoned;
        }
    }

    /// See a missing value: a blank line in a file with one column, which Hyper reads as NULL
    pub fn observe_missing(&mut self) {
        self.empties += 1;
    }

    /// The column with a name
    pub fn column(&self, name: String) -> Column {
        let (column_type, date_format) = self.column_type();
        let token_count: u64 = self.null_tokens.iter().map(|(_, count)| count).sum();
        if column_type == ColumnType::Text {
            // The NULL words and the quoted empty strings are text
            return Column {
                name,
                column_type,
                date_format,
                null_values: Vec::new(),
                nulls: self.empties,
                values: self.values + token_count + self.quoted_empties,
            };
        }
        let mut tokens: Vec<&(Vec<u8>, u64)> = self.null_tokens.iter().collect();
        tokens.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        let mut null_values: Vec<String> =
            tokens.into_iter().map(|(token, _)| String::from_utf8_lossy(token).into_owned()).collect();
        if self.quoted_empties > 0 {
            null_values.push(String::new());
        }
        Column {
            name,
            column_type,
            date_format,
            null_values,
            nulls: self.empties + self.quoted_empties + token_count,
            values: self.values,
        }
    }

    /// The most specific type that every value can be read as. Without values the column is text.
    fn column_type(&self) -> (ColumnType, DateFormat) {
        if self.values == 0 {
            return (ColumnType::Text, DateFormat::Native);
        }
        type_of(self.types, self.zoned)
    }

    /// Has the state seen a value that is no NULL?
    pub fn has_values(&self) -> bool {
        self.values > 0
    }

    /// The type of a column that read its first values as `column` and the values of this state after them: the most
    /// specific type that both can be read as
    pub fn widen(&self, column: &Column) -> Column {
        if self.values == 0 {
            return column.clone();
        }
        let (column_type, date_format) = type_of(accepted(column) & self.types, self.zoned);
        let column_type = match column_type {
            ColumnType::Timestamp if column.column_type == ColumnType::TimestampTz => ColumnType::TimestampTz,
            other => other,
        };
        Column { column_type, date_format, ..column.clone() }
    }
}

/// The types that the values of a column of a type can all be read as
fn accepted(column: &Column) -> u16 {
    match (column.column_type, column.date_format) {
        (ColumnType::BigInt, _) => value::BIGINT | value::DOUBLE,
        (ColumnType::Double, _) => value::DOUBLE,
        (ColumnType::Boolean, _) => value::BOOLEAN,
        (ColumnType::Date, DateFormat::Native) => value::DATE | value::TIMESTAMP,
        (ColumnType::Date, DateFormat::DayMonthYear) => value::DATE_DMY,
        (ColumnType::Date, DateFormat::DayMonthYearDots) => value::DATE_DMY_DOTS,
        (ColumnType::Timestamp | ColumnType::TimestampTz, _) => value::TIMESTAMP,
        (ColumnType::Text, _) => 0,
    }
}

/// The most specific type of a set of types
fn type_of(types: u16, zoned: bool) -> (ColumnType, DateFormat) {
    let has = |bit: u16| types & bit != 0;
    if has(value::BIGINT) {
        (ColumnType::BigInt, DateFormat::Native)
    } else if has(value::DOUBLE) {
        (ColumnType::Double, DateFormat::Native)
    } else if has(value::BOOLEAN) {
        (ColumnType::Boolean, DateFormat::Native)
    } else if has(value::DATE) {
        (ColumnType::Date, DateFormat::Native)
    } else if has(value::DATE_DMY) {
        (ColumnType::Date, DateFormat::DayMonthYear)
    } else if has(value::DATE_DMY_DOTS) {
        (ColumnType::Date, DateFormat::DayMonthYearDots)
    } else if has(value::TIMESTAMP) {
        (if zoned { ColumnType::TimestampTz } else { ColumnType::Timestamp }, DateFormat::Native)
    } else {
        (ColumnType::Text, DateFormat::Native)
    }
}

impl ColumnType {
    /// The type that the values of both types can be cast to: the wider number or timestamp, else text. Values are
    /// typed already, so dates of any format are dates.
    pub fn join(self, other: ColumnType) -> ColumnType {
        use ColumnType::*;
        match (self, other) {
            (a, b) if a == b => a,
            (BigInt, Double) | (Double, BigInt) => Double,
            (Date, Timestamp) | (Timestamp, Date) => Timestamp,
            (Date | Timestamp, TimestampTz) | (TimestampTz, Date | Timestamp) => TimestampTz,
            _ => Text,
        }
    }

    /// The type from its name in SQL
    pub fn from_sql(sql: &str) -> Option<ColumnType> {
        use ColumnType::*;
        [Boolean, BigInt, Double, Date, Timestamp, TimestampTz, Text].into_iter().find(|t| t.sql() == sql)
    }
}

impl DateFormat {
    /// The name of the format: `native`, `dmy` or `dmy_dots`
    pub fn name(self) -> &'static str {
        match self {
            DateFormat::Native => "native",
            DateFormat::DayMonthYear => "dmy",
            DateFormat::DayMonthYearDots => "dmy_dots",
        }
    }

    /// The format from its name
    pub fn from_name(name: &str) -> Option<DateFormat> {
        [DateFormat::Native, DateFormat::DayMonthYear, DateFormat::DayMonthYearDots]
            .into_iter()
            .find(|f| f.name() == name)
    }
}

/// The names of the columns: the trimmed names of the header, an empty one as `column_<n>`, a repeated one with a
/// suffix `_<n>`, and the missing ones as `column_<n>`
pub fn column_names(header: &[String], columns: usize) -> Vec<String> {
    let mut names: Vec<String> = Vec::with_capacity(columns);
    for i in 0..columns {
        let base = match header.get(i).map(|name| name.trim()) {
            Some(name) if !name.is_empty() => name.to_string(),
            _ => format!("column_{}", i + 1),
        };
        let mut name = base.clone();
        let mut suffix = 2;
        while names.contains(&name) {
            name = format!("{base}_{suffix}");
            suffix += 1;
        }
        names.push(name);
    }
    names
}

#[cfg(test)]
mod tests {
    use super::*;

    fn column(values: &[&str]) -> Column {
        let mut state = ColumnState::default();
        for value in values {
            match value.strip_prefix('"').and_then(|v| v.strip_suffix('"')) {
                Some(inner) => state.observe(inner.as_bytes(), true, false),
                None => state.observe(value.as_bytes(), false, false),
            }
        }
        state.column("c".to_string())
    }

    #[test]
    fn test_column_types() {
        assert_eq!(column(&["1", "2", "-3"]).column_type, ColumnType::BigInt);
        assert_eq!(column(&["1", "2.5"]).column_type, ColumnType::Double);
        assert_eq!(column(&["1", "0"]).column_type, ColumnType::BigInt);
        assert_eq!(column(&["1", "0", "yes"]).column_type, ColumnType::Boolean);
        assert_eq!(column(&["true", "False"]).column_type, ColumnType::Boolean);
        assert_eq!(column(&["2024-01-31", "01/02/2024"]).column_type, ColumnType::Date);
        assert_eq!(column(&["2024-01-31", "2024-01-31 10:00"]).column_type, ColumnType::Timestamp);
        assert_eq!(column(&["2024-01-31", "2024-01-31T10:00:00Z"]).column_type, ColumnType::TimestampTz);
        assert_eq!(column(&["1", "x"]).column_type, ColumnType::Text);
        assert_eq!(column(&["", ""]).column_type, ColumnType::Text);
        assert_eq!(column(&["007", "123"]).column_type, ColumnType::Text);
    }

    #[test]
    fn test_date_formats() {
        let dmy = column(&["31/01/2024", "01/02/2024"]);
        assert_eq!((dmy.column_type, dmy.date_format), (ColumnType::Date, DateFormat::DayMonthYear));
        assert!(dmy.read_as_text());
        let mdy = column(&["01/31/2024", "01/02/2024"]);
        assert_eq!((mdy.column_type, mdy.date_format), (ColumnType::Date, DateFormat::Native));
        let dots = column(&["31.01.2024"]);
        assert_eq!(dots.date_format, DateFormat::DayMonthYearDots);
        assert_eq!(column(&["31/01/2024", "01/31/2024"]).column_type, ColumnType::Text);
    }

    #[test]
    fn test_nulls() {
        let plain = column(&["1", "", "2"]);
        assert_eq!((plain.nulls, plain.values), (1, 2));
        assert!(plain.null_values.is_empty());
        assert!(!plain.read_as_text());
        let tokens = column(&["1", "NA", "\"\"", "n/a", "NA"]);
        assert_eq!(tokens.column_type, ColumnType::BigInt);
        assert_eq!(tokens.null_values, vec!["NA", "n/a", ""]);
        assert_eq!((tokens.nulls, tokens.values), (4, 1));
        assert!(tokens.read_as_text());
        let text = column(&["x", "NA", "\"\"", ""]);
        assert_eq!(text.column_type, ColumnType::Text);
        assert!(text.null_values.is_empty());
        assert_eq!((text.nulls, text.values), (1, 3));
    }

    #[test]
    fn test_column_names() {
        let header = ["id", " name ", "", "id", "id_2"].map(String::from);
        assert_eq!(column_names(&header, 6), vec!["id", "name", "column_3", "id_2", "id_2_2", "column_6"]);
        assert_eq!(column_names(&header, 1), vec!["id"]);
    }

    #[test]
    fn test_widen() {
        let widen = |old: &[&str], new: &[&str]| {
            let old = column(old);
            let mut state = ColumnState::default();
            for value in new {
                state.observe(value.as_bytes(), false, false);
            }
            let widened = state.widen(&old);
            (widened.column_type, widened.date_format)
        };
        assert_eq!(widen(&["1", "2"], &["2.5"]), (ColumnType::Double, DateFormat::Native));
        assert_eq!(widen(&["1", "0"], &["yes"]), (ColumnType::Text, DateFormat::Native));
        assert_eq!(widen(&["2024-01-31"], &["2024-02-01 10:00"]), (ColumnType::Timestamp, DateFormat::Native));
        assert_eq!(widen(&["2024-01-31 10:00Z"], &["2024-02-01 10:00"]), (ColumnType::TimestampTz, DateFormat::Native));
        assert_eq!(widen(&["31/01/2024"], &["02/01/2024"]), (ColumnType::Date, DateFormat::DayMonthYear));
        assert_eq!(widen(&["31/01/2024"], &["2024-01-02"]), (ColumnType::Text, DateFormat::Native));
        assert_eq!(widen(&["x"], &["1"]), (ColumnType::Text, DateFormat::Native));
        assert_eq!(ColumnType::BigInt.join(ColumnType::Double), ColumnType::Double);
        assert_eq!(ColumnType::Date.join(ColumnType::TimestampTz), ColumnType::TimestampTz);
        assert_eq!(ColumnType::Boolean.join(ColumnType::BigInt), ColumnType::Text);
        assert_eq!(ColumnType::from_sql("DOUBLE PRECISION"), Some(ColumnType::Double));
    }
}

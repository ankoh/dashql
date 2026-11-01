//! SQL literals in the Hyper dialect, printed for the dialect of a connection.
//!
//! The values of inputs (`@param :min = 10`, see docs/design/session_inputs.md) are literals written in the Hyper
//! dialect, whatever the connection of a script speaks: a number, a string, `true`, `false` or `null`, or a typed
//! literal of a date, a time, a timestamp or an interval:
//!
//! ```sql
//! 10   -2.5   'EU'   true   null   date '2024-01-01'   timestamp '2024-01-01 10:00'
//! timestamptz '2024-01-01 10:00+02'   time '10:00'   interval '3 days'   interval '3' day
//! ```
//!
//! A literal is read with the parser of DashQL, as the one expression of `select <literal>`, and printed for the
//! dialect of a connection: as written for Hyper, converted for Trino, e.g. `interval '1 day 2 hours'` becomes
//! `INTERVAL '1 02:00:00' DAY TO SECOND`. A literal that a dialect can't express is an error, it is never sent as
//! written.

use crate::analyzer::{SqlType, SqlTypeKind};
use dashql_buffers::formatting::FormattingDialect;
use dashql_buffers::parser::{AttributeKey as K, ExpressionOperator, IntervalType as IntervalTypeEnum, Node, NodeType};
use dashql_parser::attrs;
use dashql_parser::parser::context::resolve_text_span;
use dashql_parser::parser::{parse, ParsedScript};
use dashql_parser::scanner::scan;
use std::sync::Arc;

/// A literal
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SqlLiteral {
    Null,
    Bool(bool),
    /// An integer or decimal number as written, with its sign
    Number(String),
    /// The content of a string literal, without quotes and escapes
    String(String),
    Date(String),
    Time { value: String, with_time_zone: bool },
    Timestamp { value: String, with_time_zone: bool },
    /// The text of an interval, e.g. `3 days`, and its fields, e.g. `day` of `interval '3' day`
    Interval { value: String, fields: Option<IntervalTypeEnum> },
}

/// A string literal of a text, quotes are doubled
pub fn quote_string(text: &str) -> String {
    format!("'{}'", text.replace('\'', "''"))
}

/// The SQL keywords of interval fields
fn interval_fields_sql(fields: IntervalTypeEnum) -> Option<&'static str> {
    Some(match fields {
        IntervalTypeEnum::YEAR => "YEAR",
        IntervalTypeEnum::MONTH => "MONTH",
        IntervalTypeEnum::DAY => "DAY",
        IntervalTypeEnum::HOUR => "HOUR",
        IntervalTypeEnum::MINUTE => "MINUTE",
        IntervalTypeEnum::SECOND | IntervalTypeEnum::INTERVAL_SECOND => "SECOND",
        IntervalTypeEnum::YEAR_TO_MONTH => "YEAR TO MONTH",
        IntervalTypeEnum::DAY_TO_HOUR => "DAY TO HOUR",
        IntervalTypeEnum::DAY_TO_MINUTE => "DAY TO MINUTE",
        IntervalTypeEnum::DAY_TO_SECOND => "DAY TO SECOND",
        IntervalTypeEnum::HOUR_TO_MINUTE => "HOUR TO MINUTE",
        IntervalTypeEnum::HOUR_TO_SECOND => "HOUR TO SECOND",
        IntervalTypeEnum::MINUTE_TO_SECOND => "MINUTE TO SECOND",
        _ => return None,
    })
}

/// Is a text a number: an optional minus, digits, optional decimals and an optional exponent?
pub fn is_number(value: &str) -> bool {
    let b = value.as_bytes();
    let mut i = usize::from(b.first() == Some(&b'-'));
    let digits = |i: &mut usize| {
        let begin = *i;
        while *i < b.len() && b[*i].is_ascii_digit() {
            *i += 1;
        }
        *i > begin
    };
    if !digits(&mut i) {
        return false;
    }
    if b.get(i) == Some(&b'.') {
        i += 1;
        if !digits(&mut i) {
            return false;
        }
    }
    if matches!(b.get(i), Some(b'e' | b'E')) {
        i += 1;
        if matches!(b.get(i), Some(b'+' | b'-')) {
            i += 1;
        }
        if !digits(&mut i) {
            return false;
        }
    }
    i == b.len()
}

/// The text of a node
fn node_text<'a>(parsed: &'a ParsedScript, node: &Node) -> &'a str {
    let scanned = &parsed.scanned;
    let span = resolve_text_span(&scanned.text, &scanned.symbols, *node.symbol_span());
    let begin = (span.offset as usize).min(scanned.text.len());
    let end = (begin + span.length as usize).min(scanned.text.len());
    &scanned.text[begin..end]
}

fn children<'a>(parsed: &'a ParsedScript, node: &Node) -> &'a [Node] {
    let begin = node.children_begin_or_value() as usize;
    &parsed.nodes[begin..begin + node.children_count() as usize]
}

/// The content of a string literal node, without quotes and escapes
fn read_string(parsed: &ParsedScript, node: Option<&Node>) -> Result<String, String> {
    let node = node.ok_or("a typed literal needs a string")?;
    let text = node_text(parsed, node);
    match node.node_type() {
        NodeType::LITERAL_STRING if text.len() >= 2 && text.starts_with('\'') && text.ends_with('\'') => {
            Ok(text[1..text.len() - 1].replace("''", "'"))
        }
        NodeType::LITERAL_INTEGER if node.attribute_key() == K::SQL_CONST_CAST_VALUE => Ok(text.to_string()),
        _ => Err(format!("{text} is no string literal")),
    }
}

impl SqlLiteral {
    /// Read a literal in the Hyper dialect
    pub fn parse(text: &str) -> Result<SqlLiteral, String> {
        let text = text.trim();
        if text.is_empty() {
            return Err("the literal is empty".into());
        }
        let parsed = parse(Arc::new(scan(&format!("select {text}"), 0, 0)));
        if !parsed.errors.is_empty() || parsed.statements.len() != 1 {
            return Err(format!("{text} is no literal"));
        }
        // The value of the one result target of the select
        let mut values = parsed.nodes.iter().filter(|n| n.attribute_key() == K::SQL_RESULT_TARGET_VALUE);
        let (Some(value), None) = (values.next(), values.next()) else {
            return Err(format!("{text} is no literal"));
        };
        Self::read(&parsed, value).map_err(|e| format!("{e}, a literal is a number, a string, true, false, null, or a date, time, timestamp or interval literal"))
    }

    fn read(parsed: &ParsedScript, node: &Node) -> Result<SqlLiteral, String> {
        let text = node_text(parsed, node);
        match node.node_type() {
            NodeType::LITERAL_INTEGER | NodeType::LITERAL_FLOAT => Ok(SqlLiteral::Number(text.to_string())),
            NodeType::LITERAL_NULL => Ok(SqlLiteral::Null),
            NodeType::BOOL => Ok(SqlLiteral::Bool(node.children_begin_or_value() != 0)),
            NodeType::LITERAL_STRING => read_string(parsed, Some(node)).map(SqlLiteral::String),
            // -2.5
            NodeType::OBJECT_SQL_NARY_EXPRESSION => {
                let [op, args] = attrs!(children(parsed, node), [K::SQL_EXPRESSION_OPERATOR, K::SQL_EXPRESSION_ARGS]);
                let negate = op.is_some_and(|o| ExpressionOperator(o.children_begin_or_value() as _) == ExpressionOperator::NEGATE);
                let args = args.map(|a| children(parsed, a)).unwrap_or(&[]);
                match (negate, args) {
                    (true, [arg]) if matches!(arg.node_type(), NodeType::LITERAL_INTEGER | NodeType::LITERAL_FLOAT) => {
                        Ok(SqlLiteral::Number(format!("-{}", node_text(parsed, arg))))
                    }
                    _ => Err(format!("{text} is no literal")),
                }
            }
            // timestamp '...', time with time zone '...'
            NodeType::OBJECT_SQL_CONST_TYPE_CAST => {
                let [ty, value] = attrs!(children(parsed, node), [K::SQL_CONST_CAST_TYPE, K::SQL_CONST_CAST_VALUE]);
                let value = read_string(parsed, value)?;
                let [element] = attrs!(children(parsed, ty.ok_or("no type")?), [K::SQL_TYPENAME_TYPE]);
                let element = element.ok_or("no type")?;
                let [tz] = attrs!(children(parsed, element), [K::SQL_TIME_TYPE_WITH_TIMEZONE]);
                let with_time_zone = tz.is_some_and(|t| t.node_type() == NodeType::BOOL && t.children_begin_or_value() != 0);
                match element.node_type() {
                    NodeType::OBJECT_SQL_TIMESTAMP_TYPE => Ok(SqlLiteral::Timestamp { value, with_time_zone }),
                    NodeType::OBJECT_SQL_TIME_TYPE => Ok(SqlLiteral::Time { value, with_time_zone }),
                    _ => Err(format!("{text} is no literal of a supported type")),
                }
            }
            // date '...', timestamptz '...'
            NodeType::OBJECT_SQL_CONST_FUNCTION_CAST => {
                let [args, name, value] =
                    attrs!(children(parsed, node), [K::SQL_CONST_CAST_FUNC_ARGS_LIST, K::SQL_CONST_CAST_FUNC_NAME, K::SQL_CONST_CAST_VALUE]);
                if args.is_some() {
                    return Err(format!("{text} is no literal"));
                }
                let value = read_string(parsed, value)?;
                let name = name.map(|n| node_text(parsed, n).to_ascii_lowercase()).unwrap_or_default();
                match name.as_str() {
                    "date" => Ok(SqlLiteral::Date(value)),
                    "timestamptz" => Ok(SqlLiteral::Timestamp { value, with_time_zone: true }),
                    "timetz" => Ok(SqlLiteral::Time { value, with_time_zone: true }),
                    _ => Err(format!("{text} is no literal of a supported type")),
                }
            }
            // interval '3 days', interval '3' day
            NodeType::OBJECT_SQL_CONST_INTERVAL_CAST => {
                let [interval, value] = attrs!(children(parsed, node), [K::SQL_CONST_CAST_INTERVAL, K::SQL_CONST_CAST_VALUE]);
                let value = read_string(parsed, value)?;
                let fields = match interval {
                    None => None,
                    Some(i) if i.node_type() == NodeType::OBJECT_SQL_INTERVAL_TYPE => {
                        let [fields, precision] = attrs!(children(parsed, i), [K::SQL_INTERVAL_TYPE, K::SQL_INTERVAL_PRECISION]);
                        if precision.is_some() {
                            return Err(format!("{text} has a precision, an interval literal takes none"));
                        }
                        fields.map(|f| IntervalTypeEnum(f.children_begin_or_value() as _))
                    }
                    Some(_) => return Err(format!("{text} has a precision, an interval literal takes none")),
                };
                Ok(SqlLiteral::Interval { value, fields })
            }
            _ => Err(format!("{text} is no literal")),
        }
    }

    /// The literal of the value of a control with a type: a number, `true` or `false`, a date, a time, a timestamp,
    /// an interval or a string. Without a type a number is a number, `true` and `false` are booleans, and any other
    /// value is a string.
    pub fn from_value(value: &str, ty: Option<&SqlType>) -> Result<SqlLiteral, String> {
        let value = value.trim();
        let bool_of = |v: &str| {
            if v.eq_ignore_ascii_case("true") {
                Some(true)
            } else if v.eq_ignore_ascii_case("false") {
                Some(false)
            } else {
                None
            }
        };
        let Some(ty) = ty.filter(|t| t.array_dimensions == 0) else {
            if is_number(value) {
                return Ok(SqlLiteral::Number(value.to_string()));
            }
            if let Some(b) = bool_of(value) {
                return Ok(SqlLiteral::Bool(b));
            }
            return Ok(SqlLiteral::String(value.to_string()));
        };
        if ty.is_numeric() {
            if !is_number(value) {
                return Err(format!("{ty} needs a number, not \"{value}\""));
            }
            if ty.is_integer() && value.contains(['.', 'e', 'E']) {
                return Err(format!("{ty} needs an integer, not \"{value}\""));
            }
            return Ok(SqlLiteral::Number(value.to_string()));
        }
        Ok(match &ty.kind {
            SqlTypeKind::Bool => SqlLiteral::Bool(bool_of(value).ok_or_else(|| format!("{ty} needs true or false, not \"{value}\""))?),
            SqlTypeKind::Date => SqlLiteral::Date(value.to_string()),
            SqlTypeKind::Time { with_time_zone, .. } => SqlLiteral::Time { value: value.to_string(), with_time_zone: *with_time_zone },
            SqlTypeKind::Timestamp { with_time_zone, .. } => SqlLiteral::Timestamp { value: value.to_string(), with_time_zone: *with_time_zone },
            SqlTypeKind::Interval { .. } => {
                // A value that reads as an interval, the dialects that need its parts read them again
                parse_interval(value)?;
                SqlLiteral::Interval { value: value.to_string(), fields: None }
            }
            _ => SqlLiteral::String(value.to_string()),
        })
    }

    /// The type of the literal, None for null
    pub fn sql_type(&self) -> Option<SqlType> {
        let kind = match self {
            SqlLiteral::Null => return None,
            SqlLiteral::Bool(_) => SqlTypeKind::Bool,
            SqlLiteral::Number(n) if n.contains(['.', 'e', 'E']) => SqlTypeKind::Numeric { precision: None, scale: None },
            SqlLiteral::Number(_) => SqlTypeKind::Int8,
            SqlLiteral::String(_) => SqlTypeKind::Text,
            SqlLiteral::Date(_) => SqlTypeKind::Date,
            SqlLiteral::Time { with_time_zone, .. } => SqlTypeKind::Time { precision: None, with_time_zone: *with_time_zone },
            SqlLiteral::Timestamp { with_time_zone, .. } => SqlTypeKind::Timestamp { precision: None, with_time_zone: *with_time_zone },
            SqlLiteral::Interval { fields, .. } => SqlTypeKind::Interval { fields: *fields, precision: None },
        };
        Some(SqlType::scalar(kind))
    }

    /// The value as a control shows it: the number, the content of a string, the text of a typed literal
    pub fn display_value(&self) -> String {
        match self {
            SqlLiteral::Null => String::new(),
            SqlLiteral::Bool(b) => b.to_string(),
            SqlLiteral::Number(n) | SqlLiteral::String(n) | SqlLiteral::Date(n) => n.clone(),
            SqlLiteral::Time { value, .. } | SqlLiteral::Timestamp { value, .. } => value.clone(),
            SqlLiteral::Interval { value, fields: Some(fields) } => match interval_fields_sql(*fields) {
                Some(f) => format!("{value} {}", f.to_ascii_lowercase()),
                None => value.clone(),
            },
            SqlLiteral::Interval { value, .. } => value.clone(),
        }
    }

    /// The literal in the Hyper dialect, the text of an `@param` tag
    pub fn to_hyper(&self) -> String {
        match self {
            SqlLiteral::Null => "null".into(),
            SqlLiteral::Bool(b) => b.to_string(),
            SqlLiteral::Number(n) => n.clone(),
            SqlLiteral::String(s) => quote_string(s),
            SqlLiteral::Date(v) => format!("date {}", quote_string(v)),
            SqlLiteral::Time { value, with_time_zone } => format!("{} {}", if *with_time_zone { "timetz" } else { "time" }, quote_string(value)),
            SqlLiteral::Timestamp { value, with_time_zone } => {
                format!("{} {}", if *with_time_zone { "timestamptz" } else { "timestamp" }, quote_string(value))
            }
            SqlLiteral::Interval { value, fields } => match fields.and_then(interval_fields_sql) {
                Some(f) => format!("interval {} {}", quote_string(value), f.to_ascii_lowercase()),
                None => format!("interval {}", quote_string(value)),
            },
        }
    }

    /// The literal in a dialect, as an expression that stands in the place of a parameter: a negative number is in
    /// parentheses, `x-:n` would become a comment otherwise
    pub fn print(&self, dialect: FormattingDialect) -> Result<String, String> {
        if let SqlLiteral::Number(n) = self {
            return Ok(if n.starts_with('-') { format!("({n})") } else { n.clone() });
        }
        match dialect {
            FormattingDialect::TRINO => self.print_trino(),
            _ => Ok(self.print_hyper()),
        }
    }

    fn print_hyper(&self) -> String {
        match self {
            SqlLiteral::Null => "NULL".into(),
            SqlLiteral::Bool(b) => if *b { "TRUE" } else { "FALSE" }.into(),
            SqlLiteral::Number(n) => n.clone(),
            SqlLiteral::String(s) => quote_string(s),
            SqlLiteral::Date(v) => format!("DATE {}", quote_string(v)),
            SqlLiteral::Time { value, with_time_zone } => {
                format!("{} {}", if *with_time_zone { "TIME WITH TIME ZONE" } else { "TIME" }, quote_string(value))
            }
            SqlLiteral::Timestamp { value, with_time_zone } => {
                format!("{} {}", if *with_time_zone { "TIMESTAMP WITH TIME ZONE" } else { "TIMESTAMP" }, quote_string(value))
            }
            SqlLiteral::Interval { value, fields } => match fields.and_then(interval_fields_sql) {
                Some(f) => format!("INTERVAL {} {f}", quote_string(value)),
                None => format!("INTERVAL {}", quote_string(value)),
            },
        }
    }

    fn print_trino(&self) -> Result<String, String> {
        Ok(match self {
            SqlLiteral::Null => "NULL".into(),
            SqlLiteral::Bool(b) => if *b { "TRUE" } else { "FALSE" }.into(),
            SqlLiteral::Number(n) => n.clone(),
            SqlLiteral::String(s) => quote_string(s),
            SqlLiteral::Date(v) => format!("DATE {}", quote_string(v)),
            // Trino reads the time zone from the text of the literal
            SqlLiteral::Time { value, .. } => format!("TIME {}", quote_string(value)),
            SqlLiteral::Timestamp { value, .. } => format!("TIMESTAMP {}", quote_string(value)),
            SqlLiteral::Interval { value, fields } => trino_interval(value, *fields)?,
        })
    }
}

/// An interval as months and microseconds
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct IntervalParts {
    pub months: i64,
    pub micros: i64,
}

const MICROS_PER_SECOND: f64 = 1_000_000.0;

/// Read the text of an interval in the Hyper dialect: amounts with units (`1 year 2 months`, `3 days`, `1.5 hours`,
/// `-2 weeks`), a time (`01:30`, `01:30:15.5`), and `ago`, which negates the interval
pub fn parse_interval(text: &str) -> Result<IntervalParts, String> {
    let invalid = || format!("\"{text}\" is no interval, e.g. 3 days, 1 year 2 months or 01:30:00");
    let mut parts = IntervalParts::default();
    let mut months = 0.0f64;
    let mut micros = 0.0f64;
    let mut tokens = text.split_whitespace().peekable();
    let mut any = false;
    let mut negate = false;
    while let Some(token) = tokens.next() {
        let token = token.to_ascii_lowercase();
        if token == "ago" {
            negate = true;
            continue;
        }
        // A time, [-]hh:mm[:ss[.ffffff]]
        if token.contains(':') {
            let (sign, rest) = match token.strip_prefix('-') {
                Some(rest) => (-1.0, rest),
                None => (1.0, token.strip_prefix('+').unwrap_or(&token)),
            };
            let fields: Vec<&str> = rest.split(':').collect();
            if fields.len() < 2 || fields.len() > 3 {
                return Err(invalid());
            }
            let number = |s: &str| s.parse::<f64>().ok().filter(|v| v.is_finite() && *v >= 0.0);
            let hours = number(fields[0]).ok_or_else(invalid)?;
            let minutes = number(fields[1]).ok_or_else(invalid)?;
            let seconds = fields.get(2).map(|s| number(s)).unwrap_or(Some(0.0)).ok_or_else(invalid)?;
            micros += sign * ((hours * 60.0 + minutes) * 60.0 + seconds) * MICROS_PER_SECOND;
            any = true;
            continue;
        }
        // An amount and its unit, also written together, e.g. 3d
        let split = token.find(|c: char| c.is_ascii_alphabetic()).unwrap_or(token.len());
        let (amount, unit) = if split == token.len() {
            (token.clone(), tokens.next().map(|u| u.to_ascii_lowercase()).ok_or_else(invalid)?)
        } else {
            (token[..split].to_string(), token[split..].to_string())
        };
        let amount: f64 = amount.parse().ok().filter(|v: &f64| v.is_finite()).ok_or_else(invalid)?;
        let unit = unit.trim_end_matches(',');
        match unit {
            "millennium" | "millennia" | "millenniums" => months += amount * 12_000.0,
            "century" | "centuries" => months += amount * 1_200.0,
            "decade" | "decades" => months += amount * 120.0,
            "y" | "yr" | "yrs" | "year" | "years" => months += amount * 12.0,
            "mon" | "mons" | "month" | "months" => months += amount,
            "w" | "week" | "weeks" => micros += amount * 7.0 * 86_400.0 * MICROS_PER_SECOND,
            "d" | "day" | "days" => micros += amount * 86_400.0 * MICROS_PER_SECOND,
            "h" | "hr" | "hrs" | "hour" | "hours" => micros += amount * 3_600.0 * MICROS_PER_SECOND,
            "m" | "min" | "mins" | "minute" | "minutes" => micros += amount * 60.0 * MICROS_PER_SECOND,
            "s" | "sec" | "secs" | "second" | "seconds" => micros += amount * MICROS_PER_SECOND,
            "ms" | "msec" | "msecs" | "millisecond" | "milliseconds" => micros += amount * 1_000.0,
            "us" | "usec" | "usecs" | "microsecond" | "microseconds" => micros += amount,
            _ => return Err(invalid()),
        }
        any = true;
    }
    if !any {
        return Err(invalid());
    }
    // A fraction of a month is a fraction of 30 days, like in Hyper
    let whole_months = months.trunc();
    micros += (months - whole_months) * 30.0 * 86_400.0 * MICROS_PER_SECOND;
    parts.months = whole_months as i64;
    parts.micros = micros.round() as i64;
    if negate {
        parts.months = -parts.months;
        parts.micros = -parts.micros;
    }
    Ok(parts)
}

/// The parts of an interval literal with fields, e.g. `interval '3' day`
fn interval_with_fields(value: &str, fields: IntervalTypeEnum) -> Result<IntervalParts, String> {
    let unit = match fields {
        IntervalTypeEnum::YEAR => "years",
        IntervalTypeEnum::MONTH => "months",
        IntervalTypeEnum::DAY => "days",
        IntervalTypeEnum::HOUR => "hours",
        IntervalTypeEnum::MINUTE => "minutes",
        IntervalTypeEnum::SECOND | IntervalTypeEnum::INTERVAL_SECOND => "seconds",
        // The text of a range of fields reads like the text of an interval
        _ => return parse_interval(value),
    };
    if !is_number(value.trim()) {
        return parse_interval(value);
    }
    parse_interval(&format!("{} {unit}", value.trim()))
}

/// A Trino interval literal: one unit of year to month or day to second, Trino has no interval of both
fn trino_interval(value: &str, fields: Option<IntervalTypeEnum>) -> Result<String, String> {
    let parts = match fields {
        Some(fields) => interval_with_fields(value, fields)?,
        None => parse_interval(value)?,
    };
    if parts.months != 0 && parts.micros != 0 {
        return Err(format!("Trino has no interval of months and days, \"{value}\" has both"));
    }
    if parts.months != 0 {
        return Ok(if parts.months % 12 == 0 {
            format!("INTERVAL '{}' YEAR", parts.months / 12)
        } else {
            format!("INTERVAL '{}' MONTH", parts.months)
        });
    }
    let micros = parts.micros;
    for (unit, size) in [("DAY", 86_400_000_000i64), ("HOUR", 3_600_000_000), ("MINUTE", 60_000_000), ("SECOND", 1_000_000)] {
        if micros % size == 0 {
            return Ok(format!("INTERVAL '{}' {unit}", micros / size));
        }
    }
    // Fractions of a second
    let sign = if micros < 0 { "-" } else { "" };
    let abs = micros.unsigned_abs();
    let fraction = format!("{:06}", abs % 1_000_000);
    Ok(format!("INTERVAL '{sign}{}.{}' SECOND", abs / 1_000_000, fraction.trim_end_matches('0')))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(text: &str) -> SqlLiteral {
        SqlLiteral::parse(text).unwrap_or_else(|e| panic!("{text}: {e}"))
    }

    fn trino(text: &str) -> String {
        read(text).print(FormattingDialect::TRINO).unwrap_or_else(|e| panic!("{text}: {e}"))
    }

    fn hyper(text: &str) -> String {
        read(text).print(FormattingDialect::HYPER).unwrap()
    }

    #[test]
    fn reads_literals() {
        assert_eq!(read("10"), SqlLiteral::Number("10".into()));
        assert_eq!(read("-2.5"), SqlLiteral::Number("-2.5".into()));
        assert_eq!(read("'it''s'"), SqlLiteral::String("it's".into()));
        assert_eq!(read("TRUE"), SqlLiteral::Bool(true));
        assert_eq!(read("null"), SqlLiteral::Null);
        assert_eq!(read("date '2024-01-01'"), SqlLiteral::Date("2024-01-01".into()));
        assert_eq!(read("timestamp '2024-01-01 10:00'"), SqlLiteral::Timestamp { value: "2024-01-01 10:00".into(), with_time_zone: false });
        assert_eq!(read("timestamp with time zone '2024-01-01 10:00+02'"), SqlLiteral::Timestamp { value: "2024-01-01 10:00+02".into(), with_time_zone: true });
        assert_eq!(read("timestamptz '2024-01-01'"), SqlLiteral::Timestamp { value: "2024-01-01".into(), with_time_zone: true });
        assert_eq!(read("time '10:00'"), SqlLiteral::Time { value: "10:00".into(), with_time_zone: false });
        assert_eq!(read("interval '3 days'"), SqlLiteral::Interval { value: "3 days".into(), fields: None });
        assert_eq!(read("interval '3' day"), SqlLiteral::Interval { value: "3".into(), fields: Some(IntervalTypeEnum::DAY) });
    }

    #[test]
    fn rejects_expressions() {
        for text in ["", "1 + 2", "now()", "x", "'a' || 'b'", "json '{}'", "interval(3) '1 s'", "select 1", "1; select 2", "-'a'"] {
            assert!(SqlLiteral::parse(text).is_err(), "{text}");
        }
    }

    #[test]
    fn prints_hyper_as_written() {
        assert_eq!(hyper("10"), "10");
        assert_eq!(hyper("-2"), "(-2)");
        assert_eq!(hyper("'EU'"), "'EU'");
        assert_eq!(hyper("true"), "TRUE");
        assert_eq!(hyper("date '2024-01-01'"), "DATE '2024-01-01'");
        assert_eq!(hyper("interval '1 day 2 hours'"), "INTERVAL '1 day 2 hours'");
        assert_eq!(hyper("interval '3' day"), "INTERVAL '3' DAY");
        assert_eq!(read("interval '3' day").to_hyper(), "interval '3' day");
        assert_eq!(read("'it''s'").to_hyper(), "'it''s'");
    }

    #[test]
    fn prints_trino() {
        assert_eq!(trino("'it''s'"), "'it''s'");
        assert_eq!(trino("false"), "FALSE");
        assert_eq!(trino("null"), "NULL");
        assert_eq!(trino("date '2024-01-01'"), "DATE '2024-01-01'");
        assert_eq!(trino("timestamptz '2024-01-01 10:00 UTC'"), "TIMESTAMP '2024-01-01 10:00 UTC'");
        assert_eq!(trino("interval '3 days'"), "INTERVAL '3' DAY");
        assert_eq!(trino("interval '1 day 2 hours'"), "INTERVAL '26' HOUR");
        assert_eq!(trino("interval '90 minutes'"), "INTERVAL '90' MINUTE");
        assert_eq!(trino("interval '1.5 s'"), "INTERVAL '1.5' SECOND");
        assert_eq!(trino("interval '2 weeks ago'"), "INTERVAL '-14' DAY");
        assert_eq!(trino("interval '01:30:00'"), "INTERVAL '90' MINUTE");
        assert_eq!(trino("interval '1 year'"), "INTERVAL '1' YEAR");
        assert_eq!(trino("interval '1 year 2 months'"), "INTERVAL '14' MONTH");
        assert_eq!(trino("interval '3' day"), "INTERVAL '3' DAY");
        assert_eq!(trino("interval '0 days'"), "INTERVAL '0' DAY");
        assert!(read("interval '1 month 1 day'").print(FormattingDialect::TRINO).is_err());
        assert!(read("interval 'soon'").print(FormattingDialect::TRINO).is_err());
    }

    #[test]
    fn makes_literals_of_values() {
        let int = SqlType::scalar(SqlTypeKind::Int4);
        let interval = SqlType::scalar(SqlTypeKind::Interval { fields: None, precision: None });
        let date = SqlType::scalar(SqlTypeKind::Date);
        assert_eq!(SqlLiteral::from_value("10", Some(&int)).unwrap().to_hyper(), "10");
        assert!(SqlLiteral::from_value("1.5", Some(&int)).is_err());
        assert!(SqlLiteral::from_value("ten", Some(&int)).is_err());
        assert_eq!(SqlLiteral::from_value("3 days", Some(&interval)).unwrap().to_hyper(), "interval '3 days'");
        assert!(SqlLiteral::from_value("soon", Some(&interval)).is_err());
        assert_eq!(SqlLiteral::from_value("2024-01-01", Some(&date)).unwrap().to_hyper(), "date '2024-01-01'");
        assert_eq!(SqlLiteral::from_value("10", None).unwrap().to_hyper(), "10");
        assert_eq!(SqlLiteral::from_value("True", None).unwrap().to_hyper(), "true");
        assert_eq!(SqlLiteral::from_value("it's", None).unwrap().to_hyper(), "'it''s'");
        assert_eq!(read("interval '3' day").display_value(), "3 day");
    }
}

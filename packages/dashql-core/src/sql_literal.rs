//! SQL literals in the Hyper dialect, printed for the dialect of a connection.
//!
//! The values of parameters (`@param :min = 10`, see docs/design/session_inputs.md) are literals written in the Hyper
//! dialect, whatever the connection of a script speaks: a number, a string, `true`, `false` or `null`, or a typed
//! literal, e.g. `date '2024-01-01'`, `timestamptz '2024-01-01 10:00+02'` or `interval '3' day`.
//!
//! A literal is the expression of `select <literal>`, read with the parser of DashQL. Its type comes from the reader of
//! types of the analyzer (`analyzer::sql_types`), the type of `timestamp '...'` is the type `timestamp`. The formatter
//! prints it, in the Hyper dialect as the text of a tag and in the dialect of a connection where the planner binds it.
//! A literal that a dialect can't express is an error, it is never sent as written.
//!
//! An interval is a number and one unit, `interval '3' day`, which Hyper and Trino read alike. Interval text with
//! several units or without one, `interval '1 day 2 hours'` or `interval '3 days'`, is no literal: Trino has no form of
//! it, and DashQL doesn't read the text of intervals.

use crate::analyzer::sql_types::{generic_kind, interval_keyword, read_sql_type};
use crate::analyzer::clfn_calls::number;
use crate::analyzer::{SqlType, SqlTypeKind};
use crate::formatter::Formatter;
use crate::utils::{quote_string_literal, unquote_string_literal};
use dashql_buffers::formatting::{FormattingConfigT, FormattingDialect, FormattingMode, KeywordCase};
use dashql_buffers::parser::{AttributeKey as K, ExpressionOperator, IntervalType as IntervalTypeEnum, Node, NodeType};
use dashql_parser::attrs;
use dashql_parser::parser::{parse, ParsedScript};
use dashql_parser::scanner::scan;
use serde_json::Value;
use std::fmt;
use std::sync::Arc;

/// The prefix that makes a literal a statement
const SELECT: &str = "select ";

/// A literal, the expression of `select <literal>`
#[derive(Clone)]
pub struct SqlLiteral {
    /// The parsed `select <literal>`
    parsed: Arc<ParsedScript>,
    /// The node of the literal
    node: u32,
    /// The literal in the Hyper dialect, as the formatter prints it
    hyper: String,
    /// The type, None for null
    sql_type: Option<SqlType>,
    /// The value as a control shows it
    value: String,
}

impl PartialEq for SqlLiteral {
    fn eq(&self, other: &Self) -> bool {
        self.hyper == other.hyper
    }
}

impl Eq for SqlLiteral {}

impl fmt::Debug for SqlLiteral {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "SqlLiteral({})", self.hyper)
    }
}

/// The content of the string of a typed literal, e.g. `2024-01-01` of `date '2024-01-01'`
fn string_content(parsed: &ParsedScript, node: Option<&Node>) -> Result<String, String> {
    let node = node.ok_or("a typed literal needs a string")?;
    let text = parsed.node_text(node);
    match node.node_type() {
        NodeType::LITERAL_STRING => unquote_string_literal(text).ok_or_else(|| format!("{text} is no plain string")),
        _ => Err(format!("{text} is no string")),
    }
}

/// The type and the value of a literal node, an error if the node is no literal
fn read_literal(parsed: &ParsedScript, node: &Node) -> Result<(Option<SqlType>, String), String> {
    let text = parsed.node_text(node);
    let scalar = |kind| Some(SqlType::scalar(kind));
    match node.node_type() {
        NodeType::LITERAL_INTEGER => Ok((scalar(SqlTypeKind::Int8), text.to_string())),
        NodeType::LITERAL_FLOAT => Ok((scalar(SqlTypeKind::Numeric { precision: None, scale: None }), text.to_string())),
        NodeType::LITERAL_NULL => Ok((None, String::new())),
        NodeType::BOOL => Ok((scalar(SqlTypeKind::Bool), (node.children_begin_or_value() != 0).to_string())),
        NodeType::LITERAL_STRING => Ok((scalar(SqlTypeKind::Text), string_content(parsed, Some(node))?)),
        // -2.5
        NodeType::OBJECT_SQL_NARY_EXPRESSION => {
            let [op, args] = attrs!(parsed.children(node), [K::SQL_EXPRESSION_OPERATOR, K::SQL_EXPRESSION_ARGS]);
            let negate = op.is_some_and(|o| ExpressionOperator(o.children_begin_or_value() as _) == ExpressionOperator::NEGATE);
            match (negate, args.map(|a| parsed.children(a)).unwrap_or(&[])) {
                (true, [arg]) if matches!(arg.node_type(), NodeType::LITERAL_INTEGER | NodeType::LITERAL_FLOAT) => {
                    let (sql_type, value) = read_literal(parsed, arg)?;
                    Ok((sql_type, format!("-{value}")))
                }
                _ => Err(format!("{text} is no literal")),
            }
        }
        // timestamp '...', numeric(10,2) '1.5'
        NodeType::OBJECT_SQL_CONST_TYPE_CAST => {
            let [ty, value] = attrs!(parsed.children(node), [K::SQL_CONST_CAST_TYPE, K::SQL_CONST_CAST_VALUE]);
            let sql_type = ty.and_then(|t| read_sql_type(parsed, t)).ok_or_else(|| format!("{text} has no type"))?;
            Ok((Some(sql_type), string_content(parsed, value)?))
        }
        // date '...', timestamptz '...', json '...'
        NodeType::OBJECT_SQL_CONST_FUNCTION_CAST => {
            let [args, name, value] =
                attrs!(parsed.children(node), [K::SQL_CONST_CAST_FUNC_ARGS_LIST, K::SQL_CONST_CAST_FUNC_NAME, K::SQL_CONST_CAST_VALUE]);
            if args.is_some() {
                return Err(format!("{text} is no literal"));
            }
            let name = name.map(|n| parsed.node_text(n).to_ascii_lowercase()).unwrap_or_default();
            let kind = generic_kind(&name).unwrap_or(SqlTypeKind::Generic { name: name.into(), modifiers: Vec::new() });
            Ok((scalar(kind), string_content(parsed, value)?))
        }
        // interval '3' day
        NodeType::OBJECT_SQL_CONST_INTERVAL_CAST => {
            let [interval, value] = attrs!(parsed.children(node), [K::SQL_CONST_CAST_INTERVAL, K::SQL_CONST_CAST_VALUE]);
            let invalid = || format!("{text} is no interval literal, an interval is a number and a unit, e.g. interval '3' day");
            let [fields, precision] = match interval {
                Some(i) if i.node_type() == NodeType::OBJECT_SQL_INTERVAL_TYPE => {
                    attrs!(parsed.children(i), [K::SQL_INTERVAL_TYPE, K::SQL_INTERVAL_PRECISION])
                }
                _ => return Err(invalid()),
            };
            let unit = fields.map(|f| IntervalTypeEnum(f.children_begin_or_value() as _));
            let Some(unit) = unit.filter(|u| precision.is_none() && interval_unit(*u).is_some()) else { return Err(invalid()) };
            let amount = string_content(parsed, value).map_err(|_| invalid())?;
            if !is_interval_amount(&amount, unit) {
                return Err(invalid());
            }
            let sql_type = SqlType::scalar(SqlTypeKind::Interval { fields: Some(unit), precision: None });
            // The control shows the amount with the unit, `3 day`
            Ok((Some(sql_type), format!("{amount} {}", interval_unit(unit).unwrap_or_default())))
        }
        _ => Err(format!("{text} is no literal")),
    }
}

/// The units of an interval literal
const INTERVAL_UNITS: [IntervalTypeEnum; 6] =
    [IntervalTypeEnum::YEAR, IntervalTypeEnum::MONTH, IntervalTypeEnum::DAY, IntervalTypeEnum::HOUR, IntervalTypeEnum::MINUTE, IntervalTypeEnum::SECOND];

/// The keyword of the unit of an interval literal, None for ranges like `day to second`
fn interval_unit(unit: IntervalTypeEnum) -> Option<&'static str> {
    INTERVAL_UNITS.contains(&unit).then(|| interval_keyword(unit)).flatten()
}

/// Is the text the amount of an interval literal of a unit? An integer, seconds may have a fraction, `1.5`.
fn is_interval_amount(amount: &str, unit: IntervalTypeEnum) -> bool {
    let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    let unsigned = amount.strip_prefix('-').unwrap_or(amount);
    match unsigned.split_once('.') {
        None => digits(unsigned),
        Some((whole, fraction)) => unit == IntervalTypeEnum::SECOND && digits(whole) && digits(fraction),
    }
}

/// The config of the formatter of a literal, one line in lower case
fn formatting_config(dialect: FormattingDialect) -> FormattingConfigT {
    let mut config = FormattingConfigT::default();
    config.dialect = dialect;
    config.mode = FormattingMode::INLINE;
    config.max_width = u32::MAX;
    config.keyword_case = KeywordCase::LOWER;
    config
}

impl SqlLiteral {
    /// Read a literal in the Hyper dialect
    pub fn parse(text: &str) -> Result<SqlLiteral, String> {
        let text = text.trim();
        let hint = "a literal is a number, a string, true, false, null, or a typed literal like date '2024-01-01' or interval '3' day";
        let invalid = || format!("{text} is no literal, {hint}");
        if text.is_empty() {
            return Err(format!("the literal is empty, {hint}"));
        }
        let parsed = Arc::new(parse(Arc::new(scan(&format!("{SELECT}{text}"), 0, 0))));
        if !parsed.errors.is_empty() || parsed.statements.len() != 1 {
            return Err(invalid());
        }
        // The value of the one result target of the select, which is the whole text, `1 from t` is no literal
        let mut values = parsed.nodes.iter().enumerate().filter(|(_, n)| n.attribute_key() == K::SQL_RESULT_TARGET_VALUE);
        let (Some((node, value)), None) = (values.next(), values.next()) else { return Err(invalid()) };
        if parsed.node_text(value) != text {
            return Err(invalid());
        }
        let (sql_type, display) = read_literal(&parsed, value).map_err(|e| format!("{e}, {hint}"))?;
        let mut formatter = Formatter::new(&parsed);
        let hyper = formatter.format_node_at(node, &formatting_config(FormattingDialect::HYPER));
        if !formatter.is_fully_formatted() {
            return Err(invalid());
        }
        Ok(SqlLiteral { parsed, node: node as u32, hyper, sql_type, value: display })
    }

    /// The literal of the value of a control with a type. A number type reads a number, a boolean `true` or `false`,
    /// a date, a time and a timestamp read the text of their literal, an interval reads a number and a unit, `3 day`,
    /// and any other type a string.
    /// Without a type the value is a literal if it is one, e.g. `10`, `true` or `date '2024-01-01'`, and a string
    /// otherwise.
    pub fn from_value(value: &str, ty: Option<&SqlType>) -> Result<SqlLiteral, String> {
        let value = value.trim();
        let string = || SqlLiteral::parse(&quote_string_literal(value));
        let Some(ty) = ty.filter(|t| t.array_dimensions == 0) else {
            return SqlLiteral::parse(value).or_else(|_| string());
        };
        let typed = |keyword: &str| SqlLiteral::parse(&format!("{keyword} {}", quote_string_literal(value)));
        let is = |literal: &SqlLiteral, check: fn(&SqlType) -> bool| literal.sql_type.as_ref().is_some_and(check);
        match &ty.kind {
            _ if ty.is_numeric() => {
                let literal = SqlLiteral::parse(value).ok().filter(|l| is(l, SqlType::is_numeric));
                let literal = literal.ok_or_else(|| format!("{ty} needs a number, not \"{value}\""))?;
                if ty.is_integer() && !is(&literal, SqlType::is_integer) {
                    return Err(format!("{ty} needs an integer, not \"{value}\""));
                }
                Ok(literal)
            }
            SqlTypeKind::Bool => SqlLiteral::parse(value)
                .ok()
                .filter(|l| is(l, SqlType::is_bool))
                .ok_or_else(|| format!("{ty} needs true or false, not \"{value}\"")),
            SqlTypeKind::Date => typed("date"),
            SqlTypeKind::Time { with_time_zone, .. } => typed(if *with_time_zone { "timetz" } else { "time" }),
            SqlTypeKind::Timestamp { with_time_zone, .. } => typed(if *with_time_zone { "timestamptz" } else { "timestamp" }),
            SqlTypeKind::Interval { .. } => {
                let invalid = || format!("{ty} needs a number and a unit, e.g. 3 day, not \"{value}\"");
                let mut words = value.split_whitespace();
                let (Some(amount), Some(unit), None) = (words.next(), words.next(), words.next()) else { return Err(invalid()) };
                let unit = unit.to_ascii_lowercase();
                let Some(keyword) = INTERVAL_UNITS.into_iter().filter_map(interval_keyword).find(|keyword| *keyword == unit) else { return Err(invalid()) };
                SqlLiteral::parse(&format!("interval {} {keyword}", quote_string_literal(amount))).map_err(|_| invalid())
            }
            _ => string(),
        }
    }

    /// The type of the literal, None for null
    pub fn sql_type(&self) -> Option<SqlType> {
        self.sql_type.clone()
    }

    /// The value as a control shows it: the number, the content of a string, the text of a typed literal
    pub fn display_value(&self) -> String {
        self.value.clone()
    }

    /// The value as JSON, for a request: a number, a boolean, a null, or the text that a control shows
    pub fn to_json(&self) -> Value {
        match self.sql_type.as_ref().map(|t| &t.kind) {
            None => Value::Null,
            Some(SqlTypeKind::Bool) => Value::Bool(self.value == "true"),
            Some(SqlTypeKind::Int8 | SqlTypeKind::Numeric { .. }) => number(&self.value),
            Some(_) => Value::String(self.value.clone()),
        }
    }

    /// The literal in the Hyper dialect, the text of an `@param` tag
    pub fn to_hyper(&self) -> String {
        self.hyper.clone()
    }

    /// The literal in a dialect, as an expression that stands in the place of a parameter: a negative number is in
    /// parentheses, `x-:n` would become a comment otherwise
    pub fn print(&self, dialect: FormattingDialect) -> Result<String, String> {
        let mut formatter = Formatter::new(&self.parsed);
        let text = formatter.format_node_at(self.node as usize, &formatting_config(dialect));
        if !formatter.is_fully_formatted() {
            let name = crate::formatter::program::formatting_dialect_to_string(dialect);
            return Err(format!("{} can't be written in the {name} dialect", self.hyper));
        }
        Ok(if text.starts_with('-') { format!("({text})") } else { text })
    }
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

    fn kind(text: &str) -> Option<SqlTypeKind> {
        read(text).sql_type().map(|t| t.kind)
    }

    #[test]
    fn reads_literals_and_their_types() {
        assert_eq!(kind("10"), Some(SqlTypeKind::Int8));
        assert_eq!(kind("-2.5"), Some(SqlTypeKind::Numeric { precision: None, scale: None }));
        assert_eq!(kind("'it''s'"), Some(SqlTypeKind::Text));
        assert_eq!(kind("TRUE"), Some(SqlTypeKind::Bool));
        assert_eq!(kind("null"), None);
        assert_eq!(kind("date '2024-01-01'"), Some(SqlTypeKind::Date));
        assert_eq!(kind("timestamp '2024-01-01 10:00'"), Some(SqlTypeKind::Timestamp { precision: None, with_time_zone: false }));
        assert_eq!(kind("timestamp with time zone '2024-01-01'"), Some(SqlTypeKind::Timestamp { precision: None, with_time_zone: true }));
        assert_eq!(kind("timestamptz '2024-01-01'"), Some(SqlTypeKind::Timestamp { precision: None, with_time_zone: true }));
        assert_eq!(kind("interval '3' day"), Some(SqlTypeKind::Interval { fields: Some(IntervalTypeEnum::DAY), precision: None }));
        assert_eq!(kind("interval '-2' MONTH"), Some(SqlTypeKind::Interval { fields: Some(IntervalTypeEnum::MONTH), precision: None }));
        assert_eq!(read("'it''s'").display_value(), "it's");
        assert_eq!(read("interval '3' day").display_value(), "3 day");
        assert_eq!(read("interval '1.5' second").display_value(), "1.5 second");
        assert_eq!(read("-2").display_value(), "-2");
    }

    #[test]
    fn rejects_expressions() {
        for text in ["", "1 + 2", "now()", "x", "'a' || 'b'", "interval(3) '1 s'", "select 1", "1; select 2", "1 from t", "-'a'"] {
            assert!(SqlLiteral::parse(text).is_err(), "{text}");
        }
    }

    #[test]
    fn reads_intervals_of_a_number_and_a_unit() {
        // Interval text is no literal, Trino has no form of it and DashQL doesn't read it
        for text in [
            "interval '3 days'",
            "interval '1 day 2 hours'",
            "interval '01:30'",
            "interval 'soon' day",
            "interval '1.5' hour",
            "interval '1 02' day to hour",
            "interval 3 day",
        ] {
            let error = SqlLiteral::parse(text).err().unwrap_or_else(|| panic!("{text} is a literal"));
            assert!(error.contains("an interval is a number and a unit"), "{text}: {error}");
        }
    }

    #[test]
    fn prints_hyper() {
        assert_eq!(hyper("10"), "10");
        assert_eq!(hyper("-2"), "(-2)");
        assert_eq!(hyper("'EU'"), "'EU'");
        assert_eq!(hyper("TRUE"), "TRUE");
        assert_eq!(hyper("date '2024-01-01'"), "date '2024-01-01'");
        assert_eq!(hyper("interval '3' day"), "interval '3' day");
        assert_eq!(read("'it''s'").to_hyper(), "'it''s'");
    }

    #[test]
    fn prints_trino() {
        assert_eq!(trino("'it''s'"), "'it''s'");
        assert_eq!(trino("null"), "null");
        assert_eq!(trino("date '2024-01-01'"), "date '2024-01-01'");
        assert_eq!(trino("timestamptz '2024-01-01 10:00 UTC'"), "timestamp '2024-01-01 10:00 UTC'");
        assert_eq!(trino("timestamp with time zone '2024-01-01 10:00 UTC'"), "timestamp '2024-01-01 10:00 UTC'");
        assert_eq!(trino("interval '3' day"), "interval '3' day");
        assert_eq!(trino("interval '-14' month"), "interval '-14' month");
    }

    #[test]
    fn makes_literals_of_values() {
        let int = SqlType::scalar(SqlTypeKind::Int4);
        let interval = SqlType::scalar(SqlTypeKind::Interval { fields: None, precision: None });
        let date = SqlType::scalar(SqlTypeKind::Date);
        let text = SqlType::scalar(SqlTypeKind::Text);
        let value = |v: &str, t: Option<&SqlType>| SqlLiteral::from_value(v, t).map(|l| l.to_hyper());
        assert_eq!(value("10", Some(&int)), Ok("10".into()));
        assert!(value("1.5", Some(&int)).is_err());
        assert!(value("ten", Some(&int)).is_err());
        assert_eq!(value("3 day", Some(&interval)), Ok("interval '3' day".into()));
        assert_eq!(value(" 1.5  SECOND ", Some(&interval)), Ok("interval '1.5' second".into()));
        for text in ["3 days", "1 day 2 hour", "3", "day", "soon day", "1.5 hour", "3'; drop table t; -- day"] {
            assert!(value(text, Some(&interval)).is_err(), "{text}");
        }
        assert_eq!(value("2024-01-01", Some(&date)), Ok("date '2024-01-01'".into()));
        assert_eq!(value("it's", Some(&text)), Ok("'it''s'".into()));
        assert_eq!(value("10", Some(&text)), Ok("'10'".into()));
        // Without a type, a literal stays one and anything else is a string
        assert_eq!(value("10", None), Ok("10".into()));
        assert_eq!(value("true", None), Ok("true".into()));
        assert_eq!(value("interval '2' day", None), Ok("interval '2' day".into()));
        assert_eq!(value("EU", None), Ok("'EU'".into()));
        assert_eq!(value("it's", None), Ok("'it''s'".into()));
    }

    #[test]
    fn makes_literals_of_booleans_times_and_arrays() {
        let scalar = |kind| SqlType::scalar(kind);
        let value = |v: &str, t: &SqlType| SqlLiteral::from_value(v, Some(t)).map(|l| l.to_hyper());
        let boolean = scalar(SqlTypeKind::Bool);
        assert_eq!(value("TRUE", &boolean), Ok("TRUE".into()));
        let error = value("yes", &boolean).unwrap_err();
        assert!(error.contains("needs true or false"), "{error}");
        assert!(value("1", &boolean).is_err());

        let time = |with_time_zone| scalar(SqlTypeKind::Time { precision: None, with_time_zone });
        let timestamp = |with_time_zone| scalar(SqlTypeKind::Timestamp { precision: None, with_time_zone });
        assert_eq!(value("10:00", &time(false)), Ok("time '10:00'".into()));
        assert_eq!(value("10:00+01", &time(true)), Ok("timetz '10:00+01'".into()));
        assert_eq!(value("2024-01-01 10:00", &timestamp(false)), Ok("timestamp '2024-01-01 10:00'".into()));
        assert_eq!(value("2024-01-01 10:00 UTC", &timestamp(true)), Ok("timestamptz '2024-01-01 10:00 UTC'".into()));

        // Arrays have no controls, their values are read like values without a type
        let ints = SqlType { kind: SqlTypeKind::Int4, array_dimensions: 1 };
        assert_eq!(value("10", &ints), Ok("10".into()));
        assert_eq!(value("EU", &ints), Ok("'EU'".into()));
        // A generic type reads a string
        let json = scalar(SqlTypeKind::Generic { name: "json".into(), modifiers: vec![] });
        assert_eq!(value("{}", &json), Ok("'{}'".into()));
    }

    #[test]
    fn reads_typed_literals_of_any_type() {
        assert_eq!(kind("numeric(10,2) '1.5'"), Some(SqlTypeKind::Numeric { precision: Some(10), scale: Some(2) }));
        assert_eq!(kind("json '{}'"), Some(SqlTypeKind::Generic { name: "json".into(), modifiers: vec![] }));
        assert_eq!(read("json '{}'").display_value(), "{}");
        for text in ["date 1", "-true", "geography(4326) 'x'"] {
            assert!(SqlLiteral::parse(text).is_err(), "{text}");
        }
    }

    #[test]
    fn literals_compare_by_their_hyper_text() {
        assert_eq!(read("10"), read(" 10 "));
        assert_ne!(read("10"), read("'10'"));
        assert_eq!(format!("{:?}", read("'EU'")), "SqlLiteral('EU')");
    }
}

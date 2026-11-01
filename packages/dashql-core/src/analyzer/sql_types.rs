//! Structured SQL types, read from the type nodes of the parser (`OBJECT_SQL_TYPENAME`).
//!
//! The parser gives the types with standard syntax their own nodes: the numeric types are enums (`int`, `bigint`,
//! `boolean`, ...) or `OBJECT_SQL_NUMERIC_TYPE` with modifiers (`numeric(10,2)`), the character types
//! `OBJECT_SQL_CHARACTER_TYPE`, the date and time types `OBJECT_SQL_TIMESTAMP_TYPE` and `OBJECT_SQL_TIME_TYPE`, and the
//! intervals `OBJECT_SQL_INTERVAL_TYPE`. Every other type is a generic type with a name and modifiers. The generic names
//! of well-known types (`text`, `date`, `int8`, `timestamptz`, ...) map to their kinds, so `::int8` and `::bigint`
//! are the same type.

use super::state::AnalysisState;
use dashql_buffers::parser::{AttributeKey as K, CharacterType, IntervalType as IntervalTypeEnum, Node, NodeType, NumericType};
use dashql_parser::attrs;
use std::fmt;
use std::sync::Arc;

/// The kind of a SQL type
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum SqlTypeKind {
    Bool,
    Int1,
    Int2,
    Int4,
    Int8,
    Float4,
    Float8,
    Numeric { precision: Option<u32>, scale: Option<u32> },
    Varchar { length: Option<u32> },
    Char { length: Option<u32> },
    Text,
    Bit { length: Option<u32>, varying: bool },
    Date,
    Time { precision: Option<u32>, with_time_zone: bool },
    Timestamp { precision: Option<u32>, with_time_zone: bool },
    Interval { fields: Option<IntervalTypeEnum>, precision: Option<u32> },
    /// Any other type, by its lowercased name and the text of its modifiers
    Generic { name: Arc<str>, modifiers: Vec<Arc<str>> },
}

/// A SQL type
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct SqlType {
    /// The kind of the element type
    pub kind: SqlTypeKind,
    /// The number of array dimensions, 0 for a scalar type
    pub array_dimensions: u8,
}

impl SqlType {
    /// A scalar type of a kind
    pub fn scalar(kind: SqlTypeKind) -> Self {
        SqlType { kind, array_dimensions: 0 }
    }

    /// Is the type a number?
    pub fn is_numeric(&self) -> bool {
        self.array_dimensions == 0
            && matches!(
                self.kind,
                SqlTypeKind::Int1
                    | SqlTypeKind::Int2
                    | SqlTypeKind::Int4
                    | SqlTypeKind::Int8
                    | SqlTypeKind::Float4
                    | SqlTypeKind::Float8
                    | SqlTypeKind::Numeric { .. }
            )
    }

    /// Is the type an integer?
    pub fn is_integer(&self) -> bool {
        self.array_dimensions == 0 && matches!(self.kind, SqlTypeKind::Int1 | SqlTypeKind::Int2 | SqlTypeKind::Int4 | SqlTypeKind::Int8)
    }

    /// Is the type a boolean?
    pub fn is_bool(&self) -> bool {
        self.array_dimensions == 0 && self.kind == SqlTypeKind::Bool
    }
}

/// The kind of a well-known generic type name
fn generic_kind(name: &str) -> Option<SqlTypeKind> {
    Some(match name {
        "bool" => SqlTypeKind::Bool,
        "tinyint" | "int1" => SqlTypeKind::Int1,
        "int2" => SqlTypeKind::Int2,
        "int4" => SqlTypeKind::Int4,
        "int8" => SqlTypeKind::Int8,
        "float4" => SqlTypeKind::Float4,
        "float8" | "double" => SqlTypeKind::Float8,
        "text" | "string" => SqlTypeKind::Text,
        "date" => SqlTypeKind::Date,
        "timestamptz" => SqlTypeKind::Timestamp { precision: None, with_time_zone: true },
        "timetz" => SqlTypeKind::Time { precision: None, with_time_zone: true },
        _ => return None,
    })
}

/// The unsigned integer of a literal node
fn read_u32(state: &AnalysisState, node: Option<&Node>) -> Option<u32> {
    let node = node?;
    if node.node_type() != NodeType::LITERAL_INTEGER {
        return None;
    }
    state.text_at(*node.symbol_span()).trim().parse().ok()
}

/// The value of a bool node, false if missing
fn read_bool(node: Option<&Node>) -> bool {
    node.is_some_and(|n| n.node_type() == NodeType::BOOL && n.children_begin_or_value() != 0)
}

/// The modifiers of a type, the nodes of its modifier array
fn modifiers<'a>(state: &AnalysisState<'a>, node: Option<&Node>) -> &'a [Node] {
    match node {
        Some(n) if n.node_type() == NodeType::ARRAY => state.children(n),
        _ => &[],
    }
}

/// The kind of a numeric type enum
fn numeric_kind(value: u32, precision: Option<u32>, scale: Option<u32>) -> Option<SqlTypeKind> {
    Some(match NumericType(value as _) {
        NumericType::INT1 => SqlTypeKind::Int1,
        NumericType::INT2 => SqlTypeKind::Int2,
        NumericType::INT4 => SqlTypeKind::Int4,
        NumericType::INT8 => SqlTypeKind::Int8,
        NumericType::FLOAT4 => SqlTypeKind::Float4,
        NumericType::FLOAT8 => SqlTypeKind::Float8,
        NumericType::NUMERIC => SqlTypeKind::Numeric { precision, scale },
        NumericType::BOOL => SqlTypeKind::Bool,
        _ => return None,
    })
}

/// Read the kind of the node of a simple type name, None if the node is no type
fn read_kind(state: &AnalysisState, node: &Node) -> Option<SqlTypeKind> {
    match node.node_type() {
        NodeType::ENUM_SQL_NUMERIC_TYPE => numeric_kind(node.children_begin_or_value(), None, None),
        NodeType::OBJECT_SQL_NUMERIC_TYPE => {
            let [base, mods] = attrs!(state.children(node), [K::SQL_NUMERIC_TYPE_BASE, K::SQL_NUMERIC_TYPE_MODIFIERS]);
            let mods = modifiers(state, mods);
            let precision = read_u32(state, mods.first());
            let scale = read_u32(state, mods.get(1));
            numeric_kind(base?.children_begin_or_value(), precision, scale)
        }
        NodeType::OBJECT_SQL_CHARACTER_TYPE => {
            let [char_type, length] = attrs!(state.children(node), [K::SQL_CHARACTER_TYPE, K::SQL_CHARACTER_TYPE_LENGTH]);
            let length = read_u32(state, length);
            match CharacterType(char_type?.children_begin_or_value() as _) {
                CharacterType::VARCHAR => Some(SqlTypeKind::Varchar { length }),
                _ => Some(SqlTypeKind::Char { length }),
            }
        }
        NodeType::OBJECT_SQL_BIT_TYPE => {
            let [varying, length] = attrs!(state.children(node), [K::SQL_BIT_TYPE_VARYING, K::SQL_BIT_TYPE_LENGTH]);
            Some(SqlTypeKind::Bit { length: read_u32(state, length), varying: read_bool(varying) })
        }
        NodeType::OBJECT_SQL_TIMESTAMP_TYPE | NodeType::OBJECT_SQL_TIME_TYPE => {
            let [precision, tz] = attrs!(state.children(node), [K::SQL_TIME_TYPE_PRECISION, K::SQL_TIME_TYPE_WITH_TIMEZONE]);
            let precision = read_u32(state, precision);
            let with_time_zone = read_bool(tz);
            if node.node_type() == NodeType::OBJECT_SQL_TIMESTAMP_TYPE {
                Some(SqlTypeKind::Timestamp { precision, with_time_zone })
            } else {
                Some(SqlTypeKind::Time { precision, with_time_zone })
            }
        }
        NodeType::OBJECT_SQL_INTERVAL_TYPE => {
            let [fields, precision] = attrs!(state.children(node), [K::SQL_INTERVAL_TYPE, K::SQL_INTERVAL_PRECISION]);
            Some(SqlTypeKind::Interval {
                fields: fields.map(|f| IntervalTypeEnum(f.children_begin_or_value() as _)),
                precision: read_u32(state, precision),
            })
        }
        NodeType::OBJECT_SQL_GENERIC_TYPE => {
            let [name, mods] = attrs!(state.children(node), [K::SQL_GENERIC_TYPE_NAME, K::SQL_GENERIC_TYPE_MODIFIERS]);
            let name = name?;
            let name: String = match name.node_type() {
                NodeType::NAME => state.node_name(name).text.to_lowercase(),
                NodeType::ARRAY => {
                    let path = state.read_name_path(name);
                    if path.is_empty() {
                        return None;
                    }
                    path.iter().map(|&id| state.name(id).text.to_lowercase()).collect::<Vec<_>>().join(".")
                }
                _ => return None,
            };
            let mods = modifiers(state, mods);
            if mods.is_empty() {
                if let Some(kind) = generic_kind(&name) {
                    return Some(kind);
                }
            }
            Some(SqlTypeKind::Generic {
                name: name.into(),
                modifiers: mods.iter().map(|m| Arc::from(state.text_at(*m.symbol_span()).trim())).collect(),
            })
        }
        _ => None,
    }
}

/// Read a type name (`OBJECT_SQL_TYPENAME`), None if the node is no type name
pub(super) fn read_sql_type(state: &AnalysisState, node: &Node) -> Option<SqlType> {
    if node.node_type() != NodeType::OBJECT_SQL_TYPENAME {
        return None;
    }
    let [element, array] = attrs!(state.children(node), [K::SQL_TYPENAME_TYPE, K::SQL_TYPENAME_ARRAY]);
    let kind = read_kind(state, element?)?;
    // `int[]`, `int[][]`, `int[3]` and `int array` have one dimension per bound, `array` alone has one
    let array_dimensions = match array {
        Some(a) if a.node_type() == NodeType::ARRAY => (a.children_count() as u8).max(1),
        _ => 0,
    };
    Some(SqlType { kind, array_dimensions })
}

/// The name of an interval field
fn interval_fields(fields: IntervalTypeEnum) -> &'static str {
    match fields {
        IntervalTypeEnum::YEAR => "year",
        IntervalTypeEnum::MONTH => "month",
        IntervalTypeEnum::DAY => "day",
        IntervalTypeEnum::HOUR => "hour",
        IntervalTypeEnum::MINUTE => "minute",
        IntervalTypeEnum::SECOND | IntervalTypeEnum::INTERVAL_SECOND => "second",
        IntervalTypeEnum::YEAR_TO_MONTH => "year to month",
        IntervalTypeEnum::DAY_TO_HOUR => "day to hour",
        IntervalTypeEnum::DAY_TO_MINUTE => "day to minute",
        IntervalTypeEnum::DAY_TO_SECOND => "day to second",
        IntervalTypeEnum::HOUR_TO_MINUTE => "hour to minute",
        IntervalTypeEnum::HOUR_TO_SECOND => "hour to second",
        IntervalTypeEnum::MINUTE_TO_SECOND => "minute to second",
        _ => "",
    }
}

fn with_length(f: &mut fmt::Formatter<'_>, name: &str, length: Option<u32>) -> fmt::Result {
    match length {
        Some(length) => write!(f, "{name}({length})"),
        None => f.write_str(name),
    }
}

/// The SQL text of the type, e.g. `numeric(10,2)` or `timestamp with time zone`
impl fmt::Display for SqlType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.kind {
            SqlTypeKind::Bool => f.write_str("boolean")?,
            SqlTypeKind::Int1 => f.write_str("tinyint")?,
            SqlTypeKind::Int2 => f.write_str("smallint")?,
            SqlTypeKind::Int4 => f.write_str("integer")?,
            SqlTypeKind::Int8 => f.write_str("bigint")?,
            SqlTypeKind::Float4 => f.write_str("real")?,
            SqlTypeKind::Float8 => f.write_str("double precision")?,
            SqlTypeKind::Numeric { precision, scale } => match (precision, scale) {
                (Some(p), Some(s)) => write!(f, "numeric({p},{s})")?,
                (Some(p), None) => write!(f, "numeric({p})")?,
                _ => f.write_str("numeric")?,
            },
            SqlTypeKind::Varchar { length } => with_length(f, "varchar", *length)?,
            SqlTypeKind::Char { length } => with_length(f, "char", *length)?,
            SqlTypeKind::Text => f.write_str("text")?,
            SqlTypeKind::Bit { length, varying } => with_length(f, if *varying { "bit varying" } else { "bit" }, *length)?,
            SqlTypeKind::Date => f.write_str("date")?,
            SqlTypeKind::Time { precision, with_time_zone } | SqlTypeKind::Timestamp { precision, with_time_zone } => {
                let name = if matches!(self.kind, SqlTypeKind::Time { .. }) { "time" } else { "timestamp" };
                with_length(f, name, *precision)?;
                if *with_time_zone {
                    f.write_str(" with time zone")?;
                }
            }
            SqlTypeKind::Interval { fields, precision } => {
                f.write_str("interval")?;
                if let Some(fields) = fields {
                    write!(f, " {}", interval_fields(*fields))?;
                }
                if let Some(precision) = precision {
                    write!(f, "({precision})")?;
                }
            }
            SqlTypeKind::Generic { name, modifiers } => {
                f.write_str(name)?;
                if !modifiers.is_empty() {
                    write!(f, "({})", modifiers.join(","))?;
                }
            }
        }
        for _ in 0..self.array_dimensions {
            f.write_str("[]")?;
        }
        Ok(())
    }
}

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt::{self, Write};
use std::num::{ParseFloatError, ParseIntError};

use crate::error::SystemError;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
#[serde(tag = "t", content = "v")]
pub enum LogicalType {
    Boolean,
    Int64,
    Float64,
    Utf8,
    Struct(HashMap<String, LogicalType>),
    List(Box<LogicalType>),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
#[serde(tag = "t", content = "v")]
pub enum ScalarValue {
    Boolean(bool),
    Int64(i64),
    Float64(f64),
    Utf8(String),
    Struct(HashMap<String, ScalarValue>),
    List(Vec<ScalarValue>),
}

impl ScalarValue {
    pub fn cast_as(&self, ty: LogicalType) -> Result<ScalarValue, SystemError> {
        match (&self, ty) {
            // * -> Utf8
            (ScalarValue::Boolean(v), LogicalType::Utf8) => Ok(ScalarValue::Utf8(v.to_string())),
            (ScalarValue::Int64(v), LogicalType::Utf8) => Ok(ScalarValue::Utf8(v.to_string())),
            (ScalarValue::Float64(v), LogicalType::Utf8) => Ok(ScalarValue::Utf8(v.to_string())),
            (ScalarValue::Utf8(v), LogicalType::Utf8) => Ok(ScalarValue::Utf8(v.clone())),

            // * -> Float64
            (ScalarValue::Boolean(v), LogicalType::Float64) => Ok(ScalarValue::Float64(*v as i64 as f64)),
            (ScalarValue::Int64(v), LogicalType::Float64) => Ok(ScalarValue::Float64(*v as f64)),
            (ScalarValue::Float64(v), LogicalType::Float64) => Ok(ScalarValue::Float64(*v as f64)),
            (ScalarValue::Utf8(v), LogicalType::Float64) => {
                Ok(ScalarValue::Float64(v.parse().map_err(|_: ParseFloatError| {
                    SystemError::CastFailed(None, LogicalType::Utf8, LogicalType::Float64)
                })?))
            }

            // * -> Int64
            (ScalarValue::Boolean(v), LogicalType::Int64) => Ok(ScalarValue::Int64(*v as i64)),
            (ScalarValue::Int64(v), LogicalType::Int64) => Ok(ScalarValue::Int64(*v as i64)),
            (ScalarValue::Float64(v), LogicalType::Int64) => Ok(ScalarValue::Int64(*v as i64)),
            (ScalarValue::Utf8(v), LogicalType::Int64) => {
                Ok(ScalarValue::Int64(v.parse().map_err(|_: ParseIntError| {
                    SystemError::CastFailed(None, LogicalType::Utf8, LogicalType::Int64)
                })?))
            }

            // Error
            (v, t) => Err(SystemError::CastNotImplemented(None, v.get_logical_type(), t)),
        }
    }

    pub fn get_logical_type(&self) -> LogicalType {
        match &self {
            ScalarValue::Boolean(_) => LogicalType::Boolean,
            ScalarValue::Int64(_) => LogicalType::Int64,
            ScalarValue::Float64(_) => LogicalType::Float64,
            ScalarValue::Utf8(_) => LogicalType::Utf8,
            ScalarValue::Struct(fields) => LogicalType::Struct(
                fields
                    .iter()
                    .map(|(name, value)| (name.clone(), value.get_logical_type()))
                    .collect(),
            ),
            ScalarValue::List(vs) => LogicalType::List(if vs.is_empty() {
                Box::new(LogicalType::Boolean)
            } else {
                Box::new(vs[0].get_logical_type())
            }),
        }
    }

    pub fn get_f64_or_default(&self) -> f64 {
        match &self {
            ScalarValue::Float64(v) => *v,
            _ => 0.0,
        }
    }
}

impl fmt::Display for ScalarValue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ScalarValue::Boolean(v) => v.fmt(f),
            ScalarValue::Int64(v) => v.fmt(f),
            ScalarValue::Float64(v) => v.fmt(f),
            ScalarValue::Utf8(v) => v.fmt(f),
            ScalarValue::Struct(fields) => {
                f.write_char('(')?;
                for (i, (k, v)) in fields.iter().enumerate() {
                    if i > 0 {
                        f.write_str(", ")?;
                    }
                    f.write_str(&k)?;
                    f.write_str("=")?;
                    f.write_str(&v.to_string())?;
                }
                f.write_char(')')
            }
            ScalarValue::List(list) => {
                f.write_char('(')?;
                for (i, v) in list.iter().enumerate() {
                    if i > 0 {
                        f.write_str(", ")?;
                    }
                    f.write_str(&v.to_string())?;
                }
                f.write_char(')')
            }
        }
    }
}

pub fn scalar_to_json(scalar: &ScalarValue) -> serde_json::value::Value {
    match scalar {
        ScalarValue::Boolean(v) => serde_json::value::Value::Bool(*v),
        ScalarValue::Float64(v) => serde_json::value::Value::Number(
            serde_json::Number::from_f64(*v).unwrap_or(serde_json::Number::from_f64(0.0).unwrap()),
        ),
        ScalarValue::Int64(v) => serde_json::value::Value::Number(serde_json::Number::from(*v)),
        ScalarValue::Utf8(v) => serde_json::value::Value::String(v.clone()),
        ScalarValue::List(vs) => serde_json::value::Value::Array(vs.iter().map(|v| scalar_to_json(v)).collect()),
        ScalarValue::Struct(fields) => {
            let mut obj = serde_json::Map::with_capacity(fields.len());
            for (key, value) in fields {
                obj.insert(key.clone(), scalar_to_json(value));
            }
            serde_json::value::Value::Object(obj)
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use std::error::Error;

    #[test]
    pub fn test_42() -> Result<(), Box<dyn Error + Send + Sync>> {
        let value = ScalarValue::Int64(0);
        let vs = serde_json::to_string(&value)?;
        assert_eq!(vs, r#"{"t":"int64","v":0}"#);
        Ok(())
    }

    #[test]
    pub fn test_foo() -> Result<(), Box<dyn Error + Send + Sync>> {
        let value = ScalarValue::Utf8("foo".to_string());
        let vs = serde_json::to_string(&value)?;
        assert_eq!(vs, r#"{"t":"utf8","v":"foo"}"#);
        Ok(())
    }
}

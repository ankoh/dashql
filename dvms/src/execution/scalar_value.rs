use serde::Serialize;
use std::error::Error;
use std::fmt::{self, Write};

use crate::error::SystemError;
use crate::error::SystemErrorCode;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
#[serde(tag = "t", content = "v")]
pub enum LogicalType {
    Boolean,
    Int64,
    Float64,
    Varchar,
    Struct(Vec<(String, LogicalType)>),
    List(Box<LogicalType>),
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
#[serde(tag = "t", content = "v")]
pub enum ScalarValue {
    Boolean(bool),
    Int64(i64),
    Float64(f64),
    Varchar(String),
    Struct(Vec<(String, ScalarValue)>),
    List(Vec<ScalarValue>),
}

impl ScalarValue {
    pub fn cast_as(self, ty: LogicalType) -> Result<ScalarValue, SystemError> {
        match (self, ty) {
            (ScalarValue::Boolean(v), LogicalType::Varchar) => Ok(ScalarValue::Varchar(v.to_string())),
            (ScalarValue::Int64(v), LogicalType::Varchar) => Ok(ScalarValue::Varchar(v.to_string())),
            (ScalarValue::Float64(v), LogicalType::Varchar) => Ok(ScalarValue::Varchar(v.to_string())),
            (ScalarValue::Varchar(v), LogicalType::Varchar) => Ok(ScalarValue::Varchar(v)),
            (v, t) => Err(SystemError::with_detail_string(
                None,
                SystemErrorCode::CastNotImplemented,
                format!("cast not implemented: {:?} -> {:?}", v, t),
            )),
        }
    }

    pub fn opt_cast_as(
        value: Option<ScalarValue>,
        ty: LogicalType,
    ) -> Result<Option<ScalarValue>, Box<dyn Error + Send + Sync>> {
        match value {
            Some(v) => Ok(Some(v.cast_as(ty)?)),
            None => Ok(None),
        }
    }
}

impl fmt::Display for ScalarValue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ScalarValue::Boolean(v) => v.fmt(f),
            ScalarValue::Int64(v) => v.fmt(f),
            ScalarValue::Float64(v) => v.fmt(f),
            ScalarValue::Varchar(v) => v.fmt(f),
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
        ScalarValue::Varchar(v) => serde_json::value::Value::String(v.clone()),
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
        let value = ScalarValue::Varchar("foo".to_string());
        let vs = serde_json::to_string(&value)?;
        assert_eq!(vs, r#"{"t":"varchar","v":"foo"}"#);
        Ok(())
    }
}

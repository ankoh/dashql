use serde::Serialize;
use std::error::Error;

use crate::error::RawError;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
#[serde(tag = "t", content = "v")]
pub enum LogicalType {
    Boolean,
    Int64,
    Float64,
    Date,
    Time,
    Timestamp,
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
    Date(i64),
    Time(i64),
    Timestmap(i64),
    Varchar(String),
    Struct(Vec<(String, ScalarValue)>),
    List(Vec<ScalarValue>),
}

impl ScalarValue {
    pub fn cast_as(self, ty: LogicalType) -> Result<ScalarValue, Box<dyn Error + Send + Sync>> {
        match (self, ty) {
            (ScalarValue::Boolean(v), LogicalType::Varchar) => Ok(ScalarValue::Varchar(v.to_string())),
            (ScalarValue::Int64(v), LogicalType::Varchar) => Ok(ScalarValue::Varchar(v.to_string())),
            (ScalarValue::Float64(v), LogicalType::Varchar) => Ok(ScalarValue::Varchar(v.to_string())),
            (ScalarValue::Varchar(v), LogicalType::Varchar) => Ok(ScalarValue::Varchar(v)),
            (v, t) => Err(RawError::from(format!("cast not implemented: {:?} -> {:?}", v, t)).boxed()),
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
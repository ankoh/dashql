use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct LogicalDecimalType {
    width: usize,
    scale: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct LogicalStructType {
    fields: Vec<(String, SQLType)>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct LogicalListType {
    value: Box<SQLType>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub enum SQLType {
    Invalid,
    Null,
    Unknown,
    Any,

    Boolean,
    Int8,
    Int16,
    Int32,
    Int64,
    Float32,
    Float64,
    Decimal(LogicalDecimalType),

    Date,
    Time,
    Timestmap,
    Interval,

    Char,
    Varchar,
    Blob,

    Struct(LogicalStructType),
    List(LogicalListType),
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub enum SQLValueData {
    Null,
    I64(i64),
    F64(f64),
    String(String),
    List(Vec<SQLValueData>),
    Struct(Vec<SQLValueData>),
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SQLValue {
    #[serde(rename = "type")]
    pub sql_type: SQLType,
    pub data: SQLValueData,
}

#[cfg(test)]
mod test {
    use super::*;
    use std::error::Error;

    #[test]
    pub fn test_42() -> Result<(), Box<dyn Error + Send + Sync>> {
        let value = SQLValue {
            sql_type: SQLType::Int64,
            data: SQLValueData::I64(0),
        };
        let vs = serde_json::to_string(&value)?;
        assert_eq!(vs, r#"{"type":"Int64","data":{"I64":0}}"#);
        Ok(())
    }
}

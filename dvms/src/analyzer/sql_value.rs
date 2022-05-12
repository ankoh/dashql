use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct LogicalDecimalType {
    width: usize,
    scale: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct LogicalStructType {
    fields: Vec<(String, LogicalType)>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct LogicalListType {
    value: Box<LogicalType>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub enum LogicalType {
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
pub enum PhysicalData {
    Null,
    I64(i64),
    F64(f64),
    String(String),
    List(Vec<PhysicalData>),
    Struct(Vec<PhysicalData>),
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SQLValue {
    #[serde(rename = "type")]
    pub logical_type: LogicalType,
    #[serde(rename = "data")]
    pub physical_data: PhysicalData,
}

#[cfg(test)]
mod test {
    use super::*;
    use std::error::Error;

    #[test]
    pub fn test_42() -> Result<(), Box<dyn Error + Send + Sync>> {
        let value = SQLValue {
            logical_type: LogicalType::Int64,
            physical_data: PhysicalData::I64(0),
        };
        let vs = serde_json::to_string(&value)?;
        assert_eq!(vs, r#"{"type":"Int64","data":{"I64":0}}"#);
        Ok(())
    }
}

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
    pub logical_type: LogicalType,
    pub physical_data: PhysicalData,
}

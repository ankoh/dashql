use serde::Serialize;

#[derive(Debug, Clone, Serialize, Eq, PartialEq)]
pub struct SQLTaskData {
    pub script: String,
}

#[derive(Debug, Clone, Serialize, Eq, PartialEq)]
pub enum TaskData {
    Sql(SQLTaskData),
}

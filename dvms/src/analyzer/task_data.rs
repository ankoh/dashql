use super::{
    program_diff::{compute_diff, DiffOp, DiffOpCode},
    program_instance::ProgramInstance,
};
use serde::Serialize;
use std::collections::HashSet;
use std::error::Error;

#[derive(Debug, Clone, Serialize, Eq, PartialEq)]
pub struct SQLTaskData {
    pub script: String,
}

#[derive(Debug, Clone, Serialize, Eq, PartialEq)]
pub enum TaskData {
    Sql(SQLTaskData),
}

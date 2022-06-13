use crate::grammar::enums_serde::*;
use dashql_proto::syntax::{FetchMethodType, LoadMethodType};
use serde::Serialize;

use super::board_cards::Card;

#[derive(Debug, Clone, Serialize, Eq, PartialEq)]
pub struct SQLTaskData {
    pub script: String,
}

#[derive(Debug, Clone, Serialize, Eq, PartialEq)]
pub struct VizTaskData {
    pub card: Card,
}

#[derive(Debug, Clone, Serialize, Eq, PartialEq)]
pub struct InputTaskData {
    pub card: Card,
}

#[derive(Debug, Clone, Serialize, Eq, PartialEq)]
pub struct FetchTaskData {
    #[serde(with = "serde_fetch_method_type")]
    pub method: FetchMethodType,
}

#[derive(Debug, Clone, Serialize, Eq, PartialEq)]
pub struct LoadTaskData {
    #[serde(with = "serde_load_method_type")]
    pub method: LoadMethodType,
}

#[derive(Debug, Clone, Serialize, Eq, PartialEq)]
pub struct SetTaskData {}

#[derive(Debug, Clone, Serialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
#[serde(tag = "t", content = "v")]
pub enum TaskData {
    None,
    Set(SetTaskData),
    Input(InputTaskData),
    Fetch(FetchTaskData),
    Load(LoadTaskData),
    Sql(SQLTaskData),
    Viz(VizTaskData),
}

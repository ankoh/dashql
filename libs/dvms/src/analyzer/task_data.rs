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
#[serde(rename_all = "lowercase")]
#[serde(tag = "t", content = "v")]
pub enum TaskData {
    Input(InputTaskData),
    Sql(SQLTaskData),
    Viz(VizTaskData),
}

use std::sync::Arc;

use serde::Serialize;

use crate::analyzer::viz_spec::VizSpec;

use super::table_metadata::TableMetadata;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct FileDataRef {
    pub name: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct HttpDataRef {
    pub name: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct TestDataRef {
    pub name: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct TableRef {
    pub name: String,
    pub is_view: bool,
    pub metadata: Arc<TableMetadata>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct VizData {
    pub spec: Arc<VizSpec>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "t", content = "v")]
pub enum TaskData {
    FileDataRef(FileDataRef),
    HttpDataRef(HttpDataRef),
    TestDataRef(TestDataRef),
    TableRef(TableRef),
    VizData(VizData),
}
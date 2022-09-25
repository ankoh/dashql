use std::sync::Arc;

use serde::Serialize;

use crate::execution::table_metadata::TableMetadata;

#[derive(Default, Debug, Clone, Serialize, PartialEq)]
pub struct VizSpec {
    pub renderer: VizRendererData,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "t", content = "v")]
pub enum VizRendererData {
    Table(TableRendererData),
    VegaLite(VegaLiteRendererData),
    Json(JsonRendererData),
    Hex(HexRendererData),
}

#[derive(Default, Debug, Clone, Serialize, PartialEq)]
pub struct TableRendererData {
    pub table_name: String,
    pub table_metadata: Arc<TableMetadata>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct VegaLiteRendererData {
    pub table_name: String,
    pub table_metadata: Arc<TableMetadata>,
    pub sampling: Option<SamplingMethod>,
    pub spec: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct JsonRendererData {
    pub source_data_id: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct HexRendererData {
    pub source_data_id: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "t", content = "v")]
pub enum SamplingMethod {
    Reservoir(u32),
    AM4(AM4Config),
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "t", content = "v")]
pub enum DomainValue {
    Null,
    String(String),
    F64(f64),
    Bool(bool),
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct AM4Config {
    pub attribute_x: String,
    pub attribute_y: String,
    pub domain_x: Vec<DomainValue>,
}

impl Default for VizRendererData {
    fn default() -> Self {
        VizRendererData::Table(TableRendererData::default())
    }
}

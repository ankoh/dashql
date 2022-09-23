use serde::Serialize;

#[derive(Default, Debug, Clone, Serialize, PartialEq)]
pub struct VizSpec {
    pub renderer: VizRenderer,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "t", content = "v")]
pub enum VizRenderer {
    Table(TableRenderer),
    VegaLite(VegaLiteRenderer),
    Json(JsonRenderer),
    Hex(HexRenderer),
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct TableRenderer {
    pub table_name: String,
    pub row_count: Option<u32>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct VegaLiteRenderer {
    pub table_name: String,
    pub sampling: Option<SamplingMethod>,
    pub spec: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct JsonRenderer {
    pub source_data_id: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct HexRenderer {
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

impl Default for VizRenderer {
    fn default() -> Self {
        VizRenderer::Table(TableRenderer {
            table_name: "".to_string(),
            row_count: None,
        })
    }
}

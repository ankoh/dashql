use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct VizSpec {
    renderer: VizRenderer,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "t", content = "v")]
pub enum VizRenderer {
    Table(TableRenderer),
    VegaLite(VegaLiteRenderer),
}

#[derive(Debug, Clone, Serialize)]
pub struct TableRenderer {
    table_name: String,
    row_count: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VegaLiteRenderer {
    table_name: String,
    sampling: Option<SamplingMethod>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "t", content = "v")]
pub enum SamplingMethod {
    Reservoir(u32),
    AM4(AM4Config),
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "t", content = "v")]
pub enum DomainValue {
    Null,
    String(String),
    F64(f64),
    Bool(bool),
}

#[derive(Debug, Clone, Serialize)]
pub struct AM4Config {
    attribute_x: String,
    attribute_y: String,
    domain_x: Vec<DomainValue>,
}

impl Default for VizRenderer {
    fn default() -> Self {
        VizRenderer::Table(TableRenderer {
            table_name: "".to_string(),
            row_count: None,
        })
    }
}

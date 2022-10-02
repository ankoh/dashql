use arrow::datatypes::DataType;
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct InputSpec {
    pub value_type: DataType,
    pub renderer: InputRendererData,
}

impl Default for InputSpec {
    fn default() -> Self {
        InputSpec {
            value_type: DataType::Null,
            renderer: Default::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "t", content = "v")]
pub enum InputRendererData {
    Text(InputTextRendererData),
}

impl Default for InputRendererData {
    fn default() -> Self {
        InputRendererData::Text(Default::default())
    }
}

#[derive(Default, Debug, Clone, Serialize, PartialEq)]
pub struct InputTextRendererData {
    pub placeholder: String,
}

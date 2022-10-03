use arrow::datatypes::DataType;
use serde::Serialize;

use crate::execution::scalar_value::ScalarValue;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct InputSpec {
    pub value_type: DataType,
    pub default_value: Option<ScalarValue>,
    pub renderer: InputRendererData,
}

impl Default for InputSpec {
    fn default() -> Self {
        InputSpec {
            value_type: DataType::Null,
            default_value: None,
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

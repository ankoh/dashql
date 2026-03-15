use wasm_bindgen::prelude::*;

include!(concat!(env!("OUT_DIR"), "/version.rs"));

#[wasm_bindgen]
pub struct Version {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
    pub dev: u32,
    #[wasm_bindgen(skip)]
    pub text: String,
    #[wasm_bindgen(skip)]
    pub commit: String,
}

#[wasm_bindgen]
impl Version {
    #[wasm_bindgen(getter = text)]
    pub fn get_text(&self) -> String {
        self.text.clone()
    }
    #[wasm_bindgen(getter = commit)]
    pub fn get_commit(&self) -> String {
        self.commit.clone()
    }
}


#[wasm_bindgen(js_name = "getVersion")]
pub fn get_version() -> Version {
    Version {
        major: DASHQL_VERSION_MAJOR,
        minor: DASHQL_VERSION_MINOR,
        patch: DASHQL_VERSION_PATCH,
        dev: DASHQL_VERSION_DEV,
        text: DASHQL_VERSION_TEXT.to_string(),
        commit: DASHQL_VERSION_COMMIT.to_string(),
    }
}

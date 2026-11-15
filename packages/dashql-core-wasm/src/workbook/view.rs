//! The view of a script with its packed FlatBuffers, the first view of the workbook (docs/wip/runtime_projection.md)

use serde::Serialize;
use tsify::{Ts, Tsify};
use wasm_bindgen::prelude::*;

use super::{editor_update_key, Workbook};
use crate::views::FlatBufferBytes;

/// A script with the analysis of its editor. The editor update crosses when its key differs from the one that the
/// host holds, it is null otherwise.
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct WorkbookScriptView {
    pub key: u32,
    pub revision: u64,
    /// Names the editor update, an update with the same key is the same analysis
    pub editor_update_key: Option<String>,
    /// The packed editor update, null without one or when the host holds the update of the key
    #[tsify(type = "FlatBuffer<buffers_editor.EditorUpdate> | null")]
    pub editor_update: Option<FlatBufferBytes>,
}

#[wasm_bindgen]
impl Workbook {
    /// The view of a script, the editor update only if its key isn't `known_editor_update_key`
    #[wasm_bindgen(js_name = scriptView)]
    pub fn script_view(&self, key: u32, known_editor_update_key: Option<String>) -> Result<Ts<WorkbookScriptView>, JsError> {
        let view = self.with_script(key, |script| {
            let update = script.editor_update();
            let update_key = update.map(editor_update_key);
            let editor_update: Option<FlatBufferBytes> = match (update, &update_key) {
                (Some(update), Some(k)) if Some(k) != known_editor_update_key.as_ref() => {
                    Some(FlatBufferBytes(finish!(update)))
                }
                _ => None,
            };
            WorkbookScriptView { key, revision: script.revision(), editor_update_key: update_key, editor_update }
        })?;
        Ok(view.into_ts()?)
    }
}

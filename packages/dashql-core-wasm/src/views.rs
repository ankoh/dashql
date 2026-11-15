//! What the views of the module share, see docs/wip/runtime_projection.md.
//!
//! A view crosses as a JS object (`serde-wasm-bindgen`), its TypeScript declaration is generated (`tsify`). A packed
//! FlatBuffer of the core in a view crosses as a `Uint8Array` that the host reads with the generated accessors of
//! `@ankoh/dashql-core/buffers` without copying it. The declarations type it as `FlatBuffer<T>`, the bytes of a
//! FlatBuffer whose root table is `T`. A payload crosses only when its key differs from the key that the host holds.

use serde::Serialize;
use wasm_bindgen::prelude::*;

// The glue declarations sit in `src/wasm/` of `@ankoh/dashql-core`, the generated FlatBuffer code in `src/gen/`
#[wasm_bindgen(typescript_custom_section)]
const FLATBUFFER: &str = r#"
import type * as buffers_editor from '../gen/dashql/buffers/editor.js';
/** The bytes of a packed FlatBuffer whose root table is `T`, read with the generated accessors */
export type FlatBuffer<T> = Uint8Array & { readonly __flatbufferRoot?: T };
"#;

/// A packed FlatBuffer in a view, it crosses as a `Uint8Array`
#[derive(Clone, Debug, Serialize)]
#[serde(transparent)]
pub struct FlatBufferBytes(#[serde(with = "serde_bytes")] pub Vec<u8>);

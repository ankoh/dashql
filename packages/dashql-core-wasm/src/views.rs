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
import type * as buffers_diff from '../gen/dashql/buffers/diff.js';
import type * as buffers_execution from '../gen/dashql/buffers/execution.js';
/** The bytes of a packed FlatBuffer whose root table is `T`, read with the generated accessors */
export type FlatBuffer<T> = Uint8Array & { readonly __flatbufferRoot?: T };
"#;

/// A packed FlatBuffer in a view, it crosses as a `Uint8Array`
#[derive(Clone, Debug, Serialize)]
#[serde(transparent)]
pub struct FlatBufferBytes(#[serde(with = "serde_bytes")] pub Vec<u8>);

/// A view as a JS object
pub(crate) fn to_js<T: tsify::Tsify + Serialize>(view: &T) -> Result<tsify::Ts<T>, JsError> {
    Ok(tsify::Ts::from_rust(view)?)
}

/// A view that the host handed over
pub(crate) fn from_js<T: tsify::Tsify + serde::de::DeserializeOwned>(value: &tsify::Ts<T>) -> Result<T, JsError>
where
    T::JsType: Clone,
{
    Ok(value.to_rust()?)
}

/// A numeric enum of the app with the conversions from and to the enum of the runtime. It is a C-style enum of the
/// module (`#[wasm_bindgen]`, a TypeScript `enum` of the declarations) with the names and numbers of the app, and
/// crosses in a view as its number (`serde_repr`); a view names it with `#[tsify(type = "...")]`. The doc is a plain
/// string: wasm-bindgen would print the raw string of a doc comment that passes through the macro.
macro_rules! app_enum {
    ($doc:literal $name:ident: $runtime:path { $($variant:ident = $number:literal => $rt:ident),* $(,)? }) => {
        #[doc = $doc]
        #[wasm_bindgen]
        #[allow(non_camel_case_types)]
        #[derive(Clone, Copy, Debug, PartialEq, Eq, serde_repr::Serialize_repr, serde_repr::Deserialize_repr)]
        #[repr(u8)]
        pub enum $name {
            $($variant = $number),*
        }

        impl From<$runtime> for $name {
            fn from(value: $runtime) -> Self {
                type R = $runtime;
                match value {
                    $(R::$rt => Self::$variant),*
                }
            }
        }

        impl From<$name> for $runtime {
            fn from(value: $name) -> Self {
                type R = $runtime;
                match value {
                    $($name::$variant => R::$rt),*
                }
            }
        }
    };
}
pub(crate) use app_enum;

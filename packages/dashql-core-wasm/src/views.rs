//! What the views of the module share, see docs/design/dashql_core.md.
//!
//! A view crosses as a JS object (`serde-wasm-bindgen`), its TypeScript declaration is generated (`tsify`). A packed
//! FlatBuffer of the core in a view crosses as a `Uint8Array` that the host reads with the generated accessors of
//! `@akohn/dashql/buffers` without copying it. The declarations type it as `FlatBuffer<T>`, the bytes of a
//! FlatBuffer whose root table is `T`. A payload crosses only when its key differs from the key that the host holds.

use js_sys::{Array, Function, Object, Reflect};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::{Map, Number, Value};
use tsify::Tsify;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;

// The glue declarations are the generated package `@akohn/dashql-wasm` of `packages/dashql`, the generated FlatBuffer
// code is `@akohn/dashql-flatbuffers`
#[wasm_bindgen(typescript_custom_section)]
const FLATBUFFER: &str = r#"
import type * as buffers_editor from '@akohn/dashql-flatbuffers/dashql/buffers/editor.js';
import type * as buffers_diff from '@akohn/dashql-flatbuffers/dashql/buffers/diff.js';
import type * as buffers_execution from '@akohn/dashql-flatbuffers/dashql/buffers/execution.js';
import type * as buffers_profile from '@akohn/dashql-flatbuffers/dashql/buffers/profile.js';
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

/// A value of the views that is no view of its own, e.g. a list of views, as a JS object
pub(crate) fn value_to_js<T: Serialize>(value: &T) -> Result<JsValue, serde_wasm_bindgen::Error> {
    value.serialize(&serde_wasm_bindgen::Serializer::new().serialize_missing_as_null(true))
}

/// Opaque JSON in a view: a workbook file, a connection entry, the params of a connection. It crosses as a plain JS
/// value and is read the way `JSON.stringify` reads it: members that are undefined or functions are left out, `toJSON`
/// is called, numbers that are not finite are null.
#[derive(Clone, Debug, Default, PartialEq, Tsify)]
#[tsify(type = "unknown")]
pub struct JsonValue(pub Value);

impl JsonValue {
    /// Read a JS value
    pub fn of(value: &JsValue) -> JsonValue {
        JsonValue(json_of(value))
    }

    /// The JS value, objects as plain objects
    pub fn to_js(&self) -> Result<JsValue, serde_wasm_bindgen::Error> {
        self.0.serialize(&serde_wasm_bindgen::Serializer::json_compatible())
    }
}

fn skipped(value: &JsValue) -> bool {
    value.is_undefined() || value.is_function() || value.is_symbol()
}

fn json_of(value: &JsValue) -> Value {
    if let Some(flag) = value.as_bool() {
        return Value::Bool(flag);
    }
    if let Some(number) = value.as_f64() {
        return if number.fract() == 0.0 && number.abs() <= 9_007_199_254_740_991.0 {
            Value::from(number as i64)
        } else {
            Number::from_f64(number).map_or(Value::Null, Value::Number)
        };
    }
    if let Some(text) = value.as_string() {
        return Value::String(text);
    }
    if Array::is_array(value) {
        let items = Array::from(value);
        let items = items.iter().map(|item| if skipped(&item) { Value::Null } else { json_of(&item) });
        return Value::Array(items.collect());
    }
    if !value.is_object() {
        return Value::Null;
    }
    let to_json = Reflect::get(value, &JsValue::from_str("toJSON")).ok().and_then(|f| f.dyn_into::<Function>().ok());
    if let Some(to_json) = to_json {
        return to_json.call0(value).map(|value| json_of(&value)).unwrap_or(Value::Null);
    }
    let mut members = Map::new();
    for entry in Object::entries(value.unchecked_ref()).iter() {
        let entry = Array::from(&entry);
        let (key, member) = (entry.get(0), entry.get(1));
        if let (Some(key), false) = (key.as_string(), skipped(&member)) {
            members.insert(key, json_of(&member));
        }
    }
    Value::Object(members)
}

impl Serialize for JsonValue {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let value = self.to_js().map_err(serde::ser::Error::custom)?;
        serde_wasm_bindgen::preserve::serialize(&value, serializer)
    }
}

impl<'de> Deserialize<'de> for JsonValue {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value: JsValue = serde_wasm_bindgen::preserve::deserialize(deserializer)?;
        Ok(JsonValue::of(&value))
    }
}

/// A numeric enum of the app with the conversions from and to the enum of the runtime. It is a C-style enum of the
/// module (`#[wasm_bindgen]`, a TypeScript `enum` of the declarations) with the names and numbers of the app, and
/// crosses in a view as its number (`serde_repr`); a view names it with `#[tsify(type = "...")]`. The doc is a plain
/// string: wasm-bindgen would print the raw string of a doc comment that passes through the macro.
macro_rules! app_enum {
    ($doc:literal $name:ident: $runtime:path { $($variant:ident = $number:literal => $rt:ident),* $(,)? }) => {
        #[doc = $doc]
        #[wasm_bindgen]
        // The variants keep the names of the app, in capitals
        #[allow(non_camel_case_types, clippy::upper_case_acronyms)]
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

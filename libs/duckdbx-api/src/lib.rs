use wasm_bindgen::prelude::*;

mod backend;
mod backend_ffi;
mod backend_wasm;

#[wasm_bindgen(start)]
pub fn main() {
    console_error_panic_hook::set_once();
}

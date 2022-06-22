#[cfg(not(target_arch = "wasm32"))]
mod api_ffi;
#[cfg(target_arch = "wasm32")]
mod api_wasm;
mod arrow_ipc;

#[cfg(not(target_arch = "wasm32"))]
pub use api_ffi::*;
#[cfg(target_arch = "wasm32")]
pub use api_wasm::*;

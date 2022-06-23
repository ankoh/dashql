#[cfg(feature = "native")]
mod api_ffi;
#[cfg(feature = "wasm")]
mod api_wasm;
mod arrow_ipc;

#[cfg(feature = "native")]
pub use api_ffi::*;
#[cfg(feature = "wasm")]
pub use api_wasm::*;

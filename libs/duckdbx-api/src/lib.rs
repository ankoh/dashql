pub mod api;
#[cfg(not(target_arch = "wasm32"))]
mod api_ffi;
#[cfg(target_arch = "wasm32")]
mod api_wasm;
mod arrow_ipc;
mod arrow_ipc_stream;

#[cfg(not(target_arch = "wasm32"))]
pub use api_ffi::configure;
#[cfg(target_arch = "wasm32")]
pub use api_wasm::configure;

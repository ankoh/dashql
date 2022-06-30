mod dummy_runtime;
mod runtime_trait;
pub use runtime_trait::*;

#[cfg(feature = "native")]
mod native;
#[cfg(feature = "native")]
pub use native::*;

#[cfg(feature = "wasm")]
mod wasm;
#[cfg(all(feature = "wasm", not(feature = "native")))]
pub use wasm::*;

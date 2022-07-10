mod database_trait;
mod dummy_runtime;
mod runtime_trait;
pub use database_trait::*;
pub use runtime_trait::*;

#[cfg(feature = "native")]
pub(crate) mod native;
#[cfg(feature = "native")]
pub use native::*;

#[cfg(feature = "wasm")]
pub(crate) mod wasm;
#[cfg(all(feature = "wasm", not(feature = "native")))]
pub use wasm::*;

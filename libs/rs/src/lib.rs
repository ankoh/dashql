mod api;
mod api_ffi;

use api::WebAPI;

pub fn init() {
    WebAPI::init();
}

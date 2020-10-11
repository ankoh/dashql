mod api;
mod api_bindings;

use api::WebAPI;

pub fn init() {
    WebAPI::init();
}

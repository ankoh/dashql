mod webapi;
mod webapi_bindings;

use webapi::WebAPI;

pub fn init() {
    WebAPI::init();
}

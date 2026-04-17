use tauri::AppHandle;
use tauri::Emitter;
use url::Url;
use std::borrow::Cow;

pub fn process_deep_link(event: tauri::Event, handle: AppHandle) {
    let payload = event.payload();
    let Some(link) = payload.get(2..payload.len() - 2) else {
        return;
    };
    // Parse deep link
    log::info!("Receiving deep link");
    let link_parsed = match Url::parse(link) {
        Ok(url) => url,
        Err(e) => {
            log::warn!("Failed parsing deep link: {}", e);
            return;
        },
    };
    // Check scheme of deep link
    if link_parsed.scheme() != "dashql" {
        log::warn!("Rejecting deep link with unknown scheme `{}`", link_parsed.scheme());
        return;
    }
    // Unpack query parameters
    let mut link_data = None;
    for (k, v) in link_parsed.query_pairs() {
        match k {
            Cow::Borrowed("data") => {
                link_data = Some(v);
            }
            k => {
                log::warn!("Ignoring unknown deep link parameter `{}`", k);
            }
        }
    }
    // Did we receive event data?
    let link_data = if let Some(event_data) = link_data {
        event_data
    } else {
        log::warn!("Rejecting deep link missing parameter `data`");
        return;
    };
    log::info!("Emitting app event from deep link");

    // Forward the event to the PWA
    match handle.emit("dashql:event", vec![link_data.to_string()]) {
        Ok(_) => {},
        Err(e) => {
            log::error!("Failed emitting app event for deep link: {}", e);
        }
    };
}

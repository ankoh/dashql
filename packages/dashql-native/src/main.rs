// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod deep_link;
mod grpc_client;
mod duckdb;
mod duckdb_proxy;
mod duckdb_proxy_globals;
mod duckdb_proxy_routes;
#[cfg(test)]
mod duckdb_proxy_tests;
mod grpc_proxy;
mod grpc_proxy_globals;
mod grpc_proxy_routes;
#[cfg(test)]
mod grpc_proxy_tests;
#[cfg(test)]
mod duckdb_tests;
mod grpc_stream_manager;
mod http_proxy;
mod http_proxy_globals;
mod http_proxy_routes;
#[cfg(test)]
mod http_proxy_tests;
mod http_stream_manager;
mod proxy_headers;
mod ipc_router;
mod oauth_callback;
mod proto;
#[cfg(test)]
mod test;
mod status;
mod logging;
mod trace_context;

use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Listener;

use ipc_router::process_ipc_request;
use oauth_callback::start_oauth_callback_server;

#[tokio::main]
async fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![dashql_is_debug_build, start_oauth_callback_server])
        .register_asynchronous_uri_scheme_protocol(
            "dashql-native",
            move |_runtime, request, responder| {
                tokio::spawn(async move {
                    let response = process_ipc_request(request).await;
                    responder.respond(response);
                });
            },
        )
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_log::Builder::default()
                .targets(logging::config::LOG_TARGETS)
                .level(logging::config::LOG_LEVEL)
                .format(|out, message, record| {
                    let start = SystemTime::now();
                    let since_epoch = start
                        .duration_since(UNIX_EPOCH).unwrap().as_millis();

                    // Extract key-values (trace IDs already included by log call site)
                    let key_values = logging::key_values_to_json_map(record.key_values());

                    out.finish(format_args!(
                        "{}",
                        serde_json::to_string(&serde_json::json!(
                            {
                                "timestamp": since_epoch as f64,
                                "level": record.level() as usize,
                                "target": record.target().to_string(),
                                "message": message,
                                "keyValues": serde_json::Value::Object(key_values),
                            }
                        )).expect("formatting `serde_json::Value` with string keys never fails")
                    ))

                })
                .build()
        )
        .setup(|app| {
            match duckdb::linked_version() {
                Ok(Some(version)) => {
                    log::info!(target: "dashql::duckdb", "Native DuckDB linked: {}", version);
                }
                Ok(None) => {}
                Err(error) => {
                    log::warn!(target: "dashql::duckdb", "Native DuckDB probe failed: {}", error);
                }
            }
            let handle = app.handle().clone();

            // Only setup the updater plugin for Desktop builds
            #[cfg(desktop)]
            handle.plugin(tauri_plugin_updater::Builder::new().build())?;

            // Forward all deep-link events to a custom handler
            app.listen("deep-link://new-url", move |event| deep_link::process_deep_link(event, handle.clone()));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
async fn dashql_is_debug_build() -> bool {
    cfg!(debug_assertions)
}

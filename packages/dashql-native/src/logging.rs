use log::kv::{self, VisitSource};
use serde_json::{Map, Value};

/// A visitor that collects key-value pairs into a serde_json::Map
pub struct JsonVisitor {
    map: Map<String, Value>,
}

impl JsonVisitor {
    pub fn new() -> Self {
        Self {
            map: Map::new(),
        }
    }

    pub fn into_value(self) -> Value {
        Value::Object(self.map)
    }
}

impl<'kvs> VisitSource<'kvs> for JsonVisitor {
    fn visit_pair(
        &mut self,
        key: kv::Key<'kvs>,
        value: kv::Value<'kvs>,
    ) -> Result<(), kv::Error> {
        self.map.insert(
            key.to_string(),
            Value::String(value.to_string()),
        );
        Ok(())
    }
}

/// Extract key-value pairs from a log record and return them as a JSON value
pub fn key_values_to_json(source: &dyn kv::Source) -> Value {
    let mut visitor = JsonVisitor::new();
    let _ = source.visit(&mut visitor);
    visitor.into_value()
}

#[cfg(debug_assertions)]
pub mod config {
    use log::LevelFilter;
    use tauri_plugin_log::Target as LogTarget;
    use tauri_plugin_log::TargetKind as LogTargetKind;

    pub const LOG_TARGETS: [LogTarget; 2] = [LogTarget::new(LogTargetKind::Webview), LogTarget::new(LogTargetKind::Stdout)];
    pub const LOG_LEVEL: LevelFilter = LevelFilter::Debug;
}

#[cfg(not(debug_assertions))]
pub mod config {
    use log::LevelFilter;
    use tauri_plugin_log::Target as LogTarget;
    use tauri_plugin_log::TargetKind as LogTargetKind;

    pub const LOG_TARGETS: [LogTarget; 2] = [LogTarget::new(LogTargetKind::Webview), LogTarget::new(LogTargetKind::LogDir { file_name: None })];
    pub const LOG_LEVEL: LevelFilter = LevelFilter::Debug;
}

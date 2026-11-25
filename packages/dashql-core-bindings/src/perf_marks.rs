//! The recorder of the perf marks of the runtime in JS: the spans go to a function of the host, which puts them on the
//! timeline of the browser (`perfMarks` of `@akohn/dashql`, `src/core/perf_marks.ts`)

use dashql_core_runtime::perf_marks::{set_perf_recorder, PerfRecorder};
use std::rc::Rc;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    /// The clock of the timeline, the one of the spans of the host
    #[wasm_bindgen(js_namespace = performance, js_name = now)]
    fn performance_now() -> f64;
}

/// Hands every span to a function `(name, detail, start, end) => void` of the host
struct JsPerfRecorder(js_sys::Function);

impl PerfRecorder for JsPerfRecorder {
    fn now(&self) -> f64 {
        performance_now()
    }

    fn record(&self, name: &'static str, detail: &str, start: f64, end: f64) {
        let args = js_sys::Array::of4(&name.into(), &detail.into(), &start.into(), &end.into());
        // A recorder that throws loses the span, the runtime goes on
        let _ = self.0.apply(&JsValue::NULL, &args);
    }
}

/// Record the spans of the runtime with a function `(name, detail, start, end) => void`, null stops the recording
#[wasm_bindgen(js_name = setPerfRecorder)]
pub fn set_js_perf_recorder(
    #[wasm_bindgen(
        unchecked_param_type = "((name: string, detail: string, start: number, end: number) => void) | null"
    )]
    record: Option<js_sys::Function>,
) {
    set_perf_recorder(record.map(|record| Rc::new(JsPerfRecorder(record)) as Rc<dyn PerfRecorder>));
}

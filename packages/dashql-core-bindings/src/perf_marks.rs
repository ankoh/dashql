//! The recorder of the perf marks of the runtime in JS: the host hands the clock of its timeline and a function that
//! puts a span on it (`perfMarks` of `@akohn/dashql`, `src/core/perf_marks.ts`). The clock comes with the recorder, so
//! the spans of a module that another frame instantiated land on the timeline of the recorder.

use dashql_core_runtime::perf_marks::{set_perf_recorder, PerfRecorder};
use std::rc::Rc;
use wasm_bindgen::prelude::*;

#[wasm_bindgen(typescript_custom_section)]
const PERF_RECORDER: &'static str = r#"
/** Records the spans of the runtime: the clock of the timeline in milliseconds and a function that puts a span on it */
export interface PerfRecorder {
    now(): number;
    record(name: string, detail: string, start: number, end: number): void;
}
"#;

#[wasm_bindgen]
extern "C" {
    /// The recorder of the host
    #[wasm_bindgen(typescript_type = "PerfRecorder")]
    pub type JsPerfRecorder;

    #[wasm_bindgen(method)]
    fn now(this: &JsPerfRecorder) -> f64;

    #[wasm_bindgen(method, catch)]
    fn record(this: &JsPerfRecorder, name: &str, detail: &str, start: f64, end: f64) -> Result<(), JsValue>;
}

/// Hands every span to the recorder of the host
struct HostPerfRecorder(JsPerfRecorder);

impl PerfRecorder for HostPerfRecorder {
    fn now(&self) -> f64 {
        self.0.now()
    }

    fn record(&self, name: &'static str, detail: &str, start: f64, end: f64) {
        // A recorder that throws loses the span, the exception must not unwind through the runtime
        let _ = self.0.record(name, detail, start, end);
    }
}

/// Record the spans of the runtime with the recorder of the host, null stops the recording
#[wasm_bindgen(js_name = setPerfRecorder)]
pub fn set_js_perf_recorder(recorder: Option<JsPerfRecorder>) {
    set_perf_recorder(recorder.map(|recorder| Rc::new(HostPerfRecorder(recorder)) as Rc<dyn PerfRecorder>));
}

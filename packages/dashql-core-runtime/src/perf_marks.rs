//! Named time spans of the runtime for a host that wants to see where the time goes, e.g. the planner of a workbook.
//! The runtime names the spans, the host records them: the bindings of the module put them on the timeline of the
//! browser (`performance.measure`), see "Perf marks" in `docs/design/dashql_runtime.md`. Without a recorder a span
//! costs a read of a thread local.

use std::cell::RefCell;
use std::rc::Rc;

/// What records the spans of the runtime, installed by the host
pub trait PerfRecorder {
    /// The time on the clock of the host in milliseconds
    fn now(&self) -> f64;
    /// A span that ended, with a detail such as the name of a script, empty without one
    fn record(&self, name: &'static str, detail: &str, start: f64, end: f64);
}

thread_local! {
    static RECORDER: RefCell<Option<Rc<dyn PerfRecorder>>> = const { RefCell::new(None) };
}

/// Install the recorder of the host, None stops the recording
pub fn set_perf_recorder(recorder: Option<Rc<dyn PerfRecorder>>) {
    RECORDER.with(|current| *current.borrow_mut() = recorder);
}

/// The recorder while one is installed
fn recorder() -> Option<Rc<dyn PerfRecorder>> {
    RECORDER.with(|current| current.borrow().clone())
}

/// Run a function as a named span
pub fn measure<R>(name: &'static str, f: impl FnOnce() -> R) -> R {
    measure_with(name, String::new, f)
}

/// Run a function as a named span with a detail, which is only built while a recorder records
pub fn measure_with<R>(name: &'static str, detail: impl FnOnce() -> String, f: impl FnOnce() -> R) -> R {
    let Some(recorder) = recorder() else { return f() };
    let start = recorder.now();
    let result = f();
    recorder.record(name, &detail(), start, recorder.now());
    result
}

/// The start of a span that ends in another call, e.g. after an await. None while nothing records.
pub fn begin() -> Option<f64> {
    recorder().map(|recorder| recorder.now())
}

/// End a span that began with `begin`, the detail is only built while a recorder records
pub fn end(name: &'static str, detail: impl FnOnce() -> String, started: Option<f64>) {
    let (Some(start), Some(recorder)) = (started, recorder()) else { return };
    recorder.record(name, &detail(), start, recorder.now());
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[derive(Default)]
    struct Recorded {
        clock: Cell<f64>,
        spans: RefCell<Vec<(&'static str, String, f64, f64)>>,
    }

    impl PerfRecorder for Recorded {
        fn now(&self) -> f64 {
            self.clock.set(self.clock.get() + 1.0);
            self.clock.get()
        }
        fn record(&self, name: &'static str, detail: &str, start: f64, end: f64) {
            self.spans.borrow_mut().push((name, detail.to_string(), start, end));
        }
    }

    #[test]
    fn records_nested_spans_while_a_recorder_is_installed() {
        assert_eq!(measure("off", || 1), 1);
        let recorded = Rc::new(Recorded::default());
        set_perf_recorder(Some(recorded.clone()));
        let value = measure("outer", || measure_with("inner", || "a.sql".to_string(), || 2));
        set_perf_recorder(None);
        measure("off", || ());
        assert_eq!(value, 2);
        assert_eq!(
            *recorded.spans.borrow(),
            vec![("inner", "a.sql".to_string(), 2.0, 3.0), ("outer", String::new(), 1.0, 4.0)]
        );
    }

    #[test]
    fn ends_a_span_that_began_in_another_call() {
        end("off", || unreachable!("nothing began"), begin());
        let recorded = Rc::new(Recorded::default());
        set_perf_recorder(Some(recorded.clone()));
        let started = begin();
        end("run", || "w".to_string(), started);
        set_perf_recorder(None);
        assert_eq!(*recorded.spans.borrow(), vec![("run", "w".to_string(), 1.0, 2.0)]);
    }

    #[test]
    fn builds_no_detail_without_a_recorder() {
        measure_with("off", || unreachable!("the detail is built without a recorder"), || ());
    }
}

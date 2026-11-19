//! What the runtime asks of the platform it runs on.
//!
//! A service of the runtime is an async function: it reads its state, awaits the host without holding a borrow, then
//! applies what it learned. The host runs the tasks on one thread (`Host::spawn`), the futures don't need `Send`:
//! in the module they hold JavaScript values. The module implements the host over a JavaScript object whose methods
//! return promises, the tests of the crate over a fake with an executor of a single thread and a clock of their own.
//!
//! `Host` is what every service needs: the clock, timers, tasks and the log. A service adds a trait for its I/O on top,
//! e.g. `storage::StorageHost` for the storage writer. A host call that fails returns a `HostError`, the error of the
//! task that made it, never a panic.

pub mod signal;

use std::any::Any;
use std::fmt;
use std::future::Future;
use std::pin::Pin;
use std::rc::Rc;

use crate::settings::RuntimeSettings;

/// A task of the host
pub type LocalTask = Pin<Box<dyn Future<Output = ()>>>;

/// The level of a log message
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

impl LogLevel {
    pub fn name(self) -> &'static str {
        match self {
            LogLevel::Debug => "debug",
            LogLevel::Info => "info",
            LogLevel::Warn => "warn",
            LogLevel::Error => "error",
        }
    }
}

/// The platform of the runtime: the clock, timers, tasks and the log
pub trait Host: 'static {
    /// The time in milliseconds since the epoch
    fn now(&self) -> f64;
    /// A future that completes after a duration in milliseconds. Dropping it before clears the timer.
    fn sleep(&self, ms: f64) -> impl Future<Output = ()> + 'static;
    /// Run a task on the thread of the host. The task starts after the caller returned, never within the call.
    fn spawn(&self, task: LocalTask);
    /// Log a message with its details
    fn log(&self, level: LogLevel, message: &str, details: &[(&str, &str)]);
    /// The settings of the runtime, the defaults of DashQL unless the host chose others
    fn settings(&self) -> RuntimeSettings {
        RuntimeSettings::default()
    }
}

/// A script file that changed outside the app since the storage last wrote or read it
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExternalScriptChange {
    /// The workbook of the script
    pub workbook_id: String,
    /// The file name of the script
    pub file_name: String,
}

/// A failed host call.
///
/// The message describes the failure, the value is what the host failed with (a JavaScript error in the module), it
/// goes back to the host unchanged. A failure that the runtime decides on, e.g. a script that changed outside the
/// app or a call that was cancelled, is classified by the host.
#[derive(Clone)]
pub struct HostError {
    message: String,
    external_script_change: Option<ExternalScriptChange>,
    cancelled: bool,
    /// The target of the call is gone, e.g. a folder that was moved; another attempt fails the same way
    unavailable: bool,
    value: Option<Rc<dyn Any>>,
}

impl HostError {
    pub fn new(message: impl Into<String>) -> HostError {
        HostError { message: message.into(), external_script_change: None, cancelled: false, unavailable: false, value: None }
    }

    /// A call that was cancelled, e.g. a request whose token was cancelled
    pub fn cancelled() -> HostError {
        HostError { cancelled: true, ..HostError::new(crate::http::host::CANCELLED_MESSAGE) }
    }

    /// Was the call cancelled?
    pub fn is_cancelled(&self) -> bool {
        self.cancelled
    }

    /// A call whose target is gone, e.g. a workbook folder that was moved or deleted
    pub fn unavailable(message: impl Into<String>) -> HostError {
        HostError { unavailable: true, ..HostError::new(message) }
    }

    /// A write that would overwrite a script that changed outside the app
    pub fn external_script_change(workbook_id: impl Into<String>, file_name: impl Into<String>) -> HostError {
        let change = ExternalScriptChange { workbook_id: workbook_id.into(), file_name: file_name.into() };
        HostError {
            message: format!("script {} of workbook {} changed outside the app", change.file_name, change.workbook_id),
            external_script_change: Some(change),
            cancelled: false,
            unavailable: false,
            value: None,
        }
    }

    /// Keep the value the host failed with
    pub fn with_value(mut self, value: Rc<dyn Any>) -> HostError {
        self.value = Some(value);
        self
    }

    pub fn message(&self) -> &str {
        &self.message
    }

    /// The script change outside the app that the call ran into
    pub fn external_change(&self) -> Option<&ExternalScriptChange> {
        self.external_script_change.as_ref()
    }

    /// Is the target of the call gone?
    pub fn is_unavailable(&self) -> bool {
        self.unavailable
    }

    /// The value the host failed with
    pub fn value(&self) -> Option<&Rc<dyn Any>> {
        self.value.as_ref()
    }
}

impl fmt::Debug for HostError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("HostError")
            .field("message", &self.message)
            .field("external_script_change", &self.external_script_change)
            .field("cancelled", &self.cancelled)
            .field("unavailable", &self.unavailable)
            .finish()
    }
}

impl fmt::Display for HostError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

/// A future of a task of the host
pub type LocalFuture<T> = Pin<Box<dyn Future<Output = T>>>;

/// The output of a future, none if a duration in milliseconds passed first. The future is dropped then, e.g. a fetch
/// is aborted.
pub async fn timeout<H: Host + ?Sized, T>(host: &H, ms: f64, future: impl Future<Output = T>) -> Option<T> {
    let mut future = std::pin::pin!(future);
    let mut timer = std::pin::pin!(host.sleep(ms));
    std::future::poll_fn(|cx| {
        if let std::task::Poll::Ready(output) = future.as_mut().poll(cx) {
            return std::task::Poll::Ready(Some(output));
        }
        if timer.as_mut().poll(cx).is_ready() {
            return std::task::Poll::Ready(None);
        }
        std::task::Poll::Pending
    })
    .await
}

/// Futures that run at the same time, their outputs in their order once all of them completed
pub struct JoinAll<T> {
    futures: Vec<Option<LocalFuture<T>>>,
    outputs: Vec<Option<T>>,
}

impl<T> Unpin for JoinAll<T> {}

/// Run futures at the same time and complete with their outputs in their order
pub fn join_all<T>(futures: Vec<LocalFuture<T>>) -> JoinAll<T> {
    let outputs = futures.iter().map(|_| None).collect();
    JoinAll { futures: futures.into_iter().map(Some).collect(), outputs }
}

impl<T> Future for JoinAll<T> {
    type Output = Vec<T>;

    fn poll(mut self: Pin<&mut Self>, cx: &mut std::task::Context<'_>) -> std::task::Poll<Vec<T>> {
        let this = &mut *self;
        let mut pending = false;
        for (slot, output) in this.futures.iter_mut().zip(this.outputs.iter_mut()) {
            let Some(future) = slot else { continue };
            match future.as_mut().poll(cx) {
                std::task::Poll::Ready(value) => {
                    *output = Some(value);
                    *slot = None;
                }
                std::task::Poll::Pending => pending = true,
            }
        }
        if pending {
            return std::task::Poll::Pending;
        }
        std::task::Poll::Ready(this.outputs.iter_mut().filter_map(Option::take).collect())
    }
}

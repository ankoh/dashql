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
/// app, is classified by the host.
#[derive(Clone)]
pub struct HostError {
    message: String,
    external_script_change: Option<ExternalScriptChange>,
    value: Option<Rc<dyn Any>>,
}

impl HostError {
    pub fn new(message: impl Into<String>) -> HostError {
        HostError { message: message.into(), external_script_change: None, value: None }
    }

    /// A write that would overwrite a script that changed outside the app
    pub fn external_script_change(workbook_id: impl Into<String>, file_name: impl Into<String>) -> HostError {
        let change = ExternalScriptChange { workbook_id: workbook_id.into(), file_name: file_name.into() };
        HostError {
            message: format!("script {} of workbook {} changed outside the app", change.file_name, change.workbook_id),
            external_script_change: Some(change),
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
            .finish()
    }
}

impl fmt::Display for HostError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

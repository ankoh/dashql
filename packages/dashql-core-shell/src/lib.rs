//! The DashQL shell: the history of its prompts, the check whether a prompt is a complete statement, dot commands,
//! the execution protocol of queries and commands, and the records of their output.
//!
//! The host edits the prompt, the shell decides what a submitted prompt does. Queries and commands are pending
//! effects: starting an operation returns [`ShellStatus::Pending`] with an effect (type, id, payload), and the host
//! completes or cancels the effect by id, which yields the records of the output.
//!
//! The session does not own its catalog, it parses its prompts with a script on the catalog (see [`ShellSession`]).

pub mod arrow_renderer;
mod session;
pub mod unicode;

pub use arrow_renderer::ArrowRenderer;
pub use session::{CommandCompletion, ShellSession};

/// The status of a shell operation
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[repr(u32)]
pub enum ShellStatus {
    Ok = 0,
    InvalidArgument = 1,
    InternalError = 2,
    Pending = 3,
    StaleEffect = 4,
    Busy = 5,
}

/// The type of an effect
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[repr(u32)]
pub enum EffectType {
    ExecuteQuery = 1,
    ExecuteCommand = 2,
}

/// What the data of a query effect that succeeded holds, its first byte
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum QueryResultTag {
    /// A status line, e.g. `Query completed (3 rows)`, the result itself shows outside the shell
    Status = 0,
    /// A preview of the result: the length of a status line as u32 LE, the status line, then the first rows as an
    /// Arrow IPC stream or file. The shell shows the rows as a table and the status line below it.
    Preview = 1,
}

/// How the host finished an effect
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[repr(u32)]
pub enum EffectCompletionStatus {
    Success = 0,
    Error = 1,
    Cancelled = 2,
}

impl EffectCompletionStatus {
    pub fn from_u32(value: u32) -> Option<Self> {
        Some(match value {
            0 => Self::Success,
            1 => Self::Error,
            2 => Self::Cancelled,
            _ => return None,
        })
    }
}

/// The kind of a record of the output of an operation
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[repr(u32)]
pub enum ShellRecordKind {
    /// The output of a command
    Text = 0,
    /// A status line, e.g. `Query completed (3 rows)`
    Status = 1,
    /// A table of the first rows of a result, drawn with box characters
    Table = 2,
    /// The error of a query or a command
    Error = 3,
    /// The records before it go, e.g. after `.clear`
    Clear = 4,
}

/// A record of the output of an operation, one entry of the feed of the shell
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ShellRecord {
    /// What the record is
    pub kind: ShellRecordKind,
    /// The text of the record without a trailing line break, lines end with `\n`
    pub text: String,
}

impl ShellRecord {
    pub fn new(kind: ShellRecordKind, text: impl Into<String>) -> Self {
        Self { kind, text: text.into() }
    }
}

/// What a prompt is
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct PromptInfo {
    /// Is the prompt a dot command? The host offers no SQL assistance for it.
    pub is_command: bool,
    /// Does Enter submit the prompt? A dot command on one line or a single statement that ends with a semicolon.
    pub is_complete: bool,
}

/// An effect that the host performs for a pending operation
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ShellEffect {
    /// The kind of the effect
    pub effect_type: EffectType,
    /// The effect id that the host passes back on completion
    pub id: u64,
    /// The query or the dot command
    pub payload: Vec<u8>,
}

/// The result of an operation: the records of its output, an effect or an error message
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ShellOperation {
    /// The status of the operation
    pub status: ShellStatus,
    /// The records of the output of a finished operation
    pub records: Vec<ShellRecord>,
    /// The error message if the status is neither OK nor pending
    pub message: String,
    /// The effect of a pending operation
    pub effect: Option<ShellEffect>,
}

impl ShellOperation {
    /// An operation that failed with a message
    pub fn error(status: ShellStatus, message: impl Into<String>) -> Self {
        Self { status, records: Vec::new(), message: message.into(), effect: None }
    }

    /// An operation that finished with records
    pub fn ok(records: Vec<ShellRecord>) -> Self {
        Self { status: ShellStatus::Ok, records, message: String::new(), effect: None }
    }

    pub fn pending(effect: ShellEffect) -> Self {
        Self { status: ShellStatus::Pending, records: Vec::new(), message: String::new(), effect: Some(effect) }
    }
}

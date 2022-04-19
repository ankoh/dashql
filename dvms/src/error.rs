use std::error::Error;
use std::fmt;

#[derive(Debug)]
pub struct RawError {
    pub what: String,
}

impl RawError {
    pub fn boxed(self) -> Box<Self> {
        Box::new(self)
    }
}

impl fmt::Display for RawError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{}", self.what)
    }
}

impl Error for RawError {
    fn description(&self) -> &str {
        &self.what
    }
}

impl From<&str> for RawError {
    fn from(m: &str) -> Self {
        Self {
            what: m.to_string(),
        }
    }
}

impl From<String> for RawError {
    fn from(m: String) -> Self {
        Self { what: m }
    }
}

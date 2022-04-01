use std::error::Error;
use std::fmt;

#[derive(Debug)]
pub struct StringError {
    pub what: String,
}

impl StringError {
    pub fn from_string(msg: String) -> Self {
        Self { what: msg }
    }
}

impl fmt::Display for StringError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{}", self.what)
    }
}

impl Error for StringError {
    fn description(&self) -> &str {
        &self.what
    }
}

#[derive(Debug)]
pub struct StaticStrError {
    what: &'static str,
}

impl StaticStrError {
    #[allow(unused)]
    pub fn from_msg(msg: &'static str) -> StaticStrError {
        Self { what: msg }
    }
}

impl fmt::Display for StaticStrError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{}", self.what)
    }
}

impl Error for StaticStrError {
    fn description(&self) -> &str {
        self.what
    }
}

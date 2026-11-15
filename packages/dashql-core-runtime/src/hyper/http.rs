//! HTTP requests and responses as data. The protocols of the module build requests and read responses, the host sends
//! them with its HTTP client (fetch, the proxy of the desktop app) and hands the responses back.

use std::fmt;

/// The method of a request
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HttpMethod {
    Get,
    Post,
    Delete,
}

impl HttpMethod {
    /// The name of the method, e.g. `GET`
    pub fn as_str(self) -> &'static str {
        match self {
            HttpMethod::Get => "GET",
            HttpMethod::Post => "POST",
            HttpMethod::Delete => "DELETE",
        }
    }
}

impl fmt::Display for HttpMethod {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Header fields in the order they were set. Names are case-insensitive and kept in lower case, like the `Headers` of
/// fetch, setting a name again replaces its value in place.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Headers {
    fields: Vec<(String, String)>,
}

impl Headers {
    /// No headers
    pub fn new() -> Self {
        Self::default()
    }

    /// Headers from name-value pairs, a later pair replaces an earlier one of the same name
    pub fn from_pairs<K: AsRef<str>, V: AsRef<str>>(pairs: impl IntoIterator<Item = (K, V)>) -> Self {
        let mut headers = Self::new();
        for (name, value) in pairs {
            headers.set(name.as_ref(), value.as_ref());
        }
        headers
    }

    /// Set a header, replacing its value
    pub fn set(&mut self, name: &str, value: &str) {
        let name = name.to_ascii_lowercase();
        match self.fields.iter_mut().find(|(field, _)| *field == name) {
            Some((_, slot)) => *slot = value.to_string(),
            None => self.fields.push((name, value.to_string())),
        }
    }

    /// Set the headers of others, replacing the values of the same names
    pub fn extend(&mut self, others: &Headers) {
        for (name, value) in &others.fields {
            self.set(name, value);
        }
    }

    /// Remove a header
    pub fn remove(&mut self, name: &str) {
        self.fields.retain(|(field, _)| !field.eq_ignore_ascii_case(name));
    }

    /// The value of a header
    pub fn get(&self, name: &str) -> Option<&str> {
        self.fields.iter().find(|(field, _)| field.eq_ignore_ascii_case(name)).map(|(_, value)| value.as_str())
    }

    /// Is a header set?
    pub fn has(&self, name: &str) -> bool {
        self.get(name).is_some()
    }

    /// The headers as name-value pairs, the names in lower case
    pub fn iter(&self) -> impl Iterator<Item = (&str, &str)> {
        self.fields.iter().map(|(name, value)| (name.as_str(), value.as_str()))
    }

    /// The number of headers
    pub fn len(&self) -> usize {
        self.fields.len()
    }

    /// Are there no headers?
    pub fn is_empty(&self) -> bool {
        self.fields.is_empty()
    }
}

/// A request for the HTTP client of the host
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpRequest {
    /// The method
    pub method: HttpMethod,
    /// The absolute url
    pub url: String,
    /// The headers
    pub headers: Headers,
    /// The body, none for a request without one
    pub body: Option<String>,
}

/// A response that the host received
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HttpResponse {
    /// The status code
    pub status: u16,
    /// The status text, e.g. `Bad Gateway`
    pub status_text: String,
    /// The headers
    pub headers: Headers,
    /// The body
    pub body: Vec<u8>,
}

impl HttpResponse {
    /// A response with a status and a body
    pub fn new(status: u16, body: impl Into<Vec<u8>>) -> Self {
        Self { status, status_text: String::new(), headers: Headers::new(), body: body.into() }
    }

    /// The response with a header
    pub fn with_header(mut self, name: &str, value: &str) -> Self {
        self.headers.set(name, value);
        self
    }

    /// The response with a status text
    pub fn with_status_text(mut self, status_text: &str) -> Self {
        self.status_text = status_text.to_string();
        self
    }
}

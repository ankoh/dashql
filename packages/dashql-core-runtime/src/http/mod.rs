//! HTTP as data, for every connector of the runtime: the request that a protocol wants the host to send, the response
//! that the host hands back, case-insensitive headers and URLs. The host sends a request with its HTTP client (fetch,
//! the proxy of the desktop app) through `HttpHost::fetch` and passes the response on.
//!
//! - `url`: absolute URLs as the browsers parse them, resolving a URL of a response, and the encodings of URL
//!   components and forms.
//! - `base64`: base64 like `btoa` and `atob`.
//! - `host`: the trait of the host that sends requests, and a cancellation that stops a request.

pub mod base64;
pub mod host;
pub mod url;

use std::any::Any;
use std::fmt;
use std::rc::Rc;

pub use host::{CancellationToken, HttpHost};
pub use url::{InvalidUrl, Url};

/// The method of a request
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HttpMethod {
    Get,
    Head,
    Post,
    Put,
    Patch,
    Delete,
    Options,
    /// Another method, in upper case
    Other(String),
}

impl HttpMethod {
    /// The method of its name in any case, e.g. `get`
    pub fn parse(name: &str) -> HttpMethod {
        match name.to_ascii_uppercase().as_str() {
            "GET" => HttpMethod::Get,
            "HEAD" => HttpMethod::Head,
            "POST" => HttpMethod::Post,
            "PUT" => HttpMethod::Put,
            "PATCH" => HttpMethod::Patch,
            "DELETE" => HttpMethod::Delete,
            "OPTIONS" => HttpMethod::Options,
            other => HttpMethod::Other(other.to_string()),
        }
    }

    /// The name of the method, e.g. `GET`
    pub fn as_str(&self) -> &str {
        match self {
            HttpMethod::Get => "GET",
            HttpMethod::Head => "HEAD",
            HttpMethod::Post => "POST",
            HttpMethod::Put => "PUT",
            HttpMethod::Patch => "PATCH",
            HttpMethod::Delete => "DELETE",
            HttpMethod::Options => "OPTIONS",
            HttpMethod::Other(name) => name,
        }
    }
}

impl fmt::Display for HttpMethod {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl PartialEq<&str> for HttpMethod {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}

/// Header fields in the order they were set. Names compare without case, like the `Headers` of fetch: setting a name
/// again replaces its value in place, appending joins the values with a comma. A name keeps the case it was last set
/// with.
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
    pub fn set(&mut self, name: &str, value: impl Into<String>) {
        let value = value.into();
        match self.fields.iter_mut().find(|(field, _)| field.eq_ignore_ascii_case(name)) {
            Some(slot) => *slot = (name.to_string(), value),
            None => self.fields.push((name.to_string(), value)),
        }
    }

    /// Append a value to a header, joined with the values before like `Headers.append`
    pub fn append(&mut self, name: &str, value: &str) {
        match self.fields.iter_mut().find(|(field, _)| field.eq_ignore_ascii_case(name)) {
            Some((_, slot)) => {
                slot.push_str(", ");
                slot.push_str(value);
            }
            None => self.fields.push((name.to_string(), value.to_string())),
        }
    }

    /// Set the headers of others, replacing the values of the same names
    pub fn extend(&mut self, others: &Headers) {
        for (name, value) in &others.fields {
            self.set(name, value.clone());
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

    /// The headers as name-value pairs, in order
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

impl<K: AsRef<str>, V: AsRef<str>> FromIterator<(K, V)> for Headers {
    fn from_iter<I: IntoIterator<Item = (K, V)>>(pairs: I) -> Self {
        Headers::from_pairs(pairs)
    }
}

/// A request for the HTTP client of the host. It carries no abort signal, the host stops the request of a cancelled
/// task.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpRequest {
    /// The method
    pub method: HttpMethod,
    /// The absolute URL
    pub url: String,
    /// The headers
    pub headers: Headers,
    /// The body, none for a request without one
    pub body: Option<String>,
    /// Does the request or its response carry credentials, e.g. a token request? The host keeps no record of their
    /// bodies and headers, e.g. in the log of requests.
    pub sensitive: bool,
}

impl HttpRequest {
    /// A request without headers or body
    pub fn new(method: HttpMethod, url: impl Into<String>) -> Self {
        Self { method, url: url.into(), headers: Headers::new(), body: None, sensitive: false }
    }

    /// The request as one whose bodies and headers carry credentials
    pub fn sensitive(mut self) -> Self {
        self.sensitive = true;
        self
    }

    /// Set a header, replacing a header of the same name regardless of its case
    pub fn set_header(&mut self, name: &str, value: impl Into<String>) {
        self.headers.set(name, value);
    }

    /// The value of a header, the name in any case
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(name)
    }
}

/// Bytes that stayed with the host, e.g. the body of a response that the module passes on without reading it. The
/// module holds them by a handle and knows only their length.
#[derive(Clone)]
pub struct HostBytes {
    value: Rc<dyn Any>,
    length: usize,
}

impl HostBytes {
    /// The bytes of a value of the host
    pub fn new(value: Rc<dyn Any>, length: usize) -> Self {
        Self { value, length }
    }

    /// The value of the host
    pub fn value(&self) -> &Rc<dyn Any> {
        &self.value
    }

    /// The number of bytes
    pub fn len(&self) -> usize {
        self.length
    }

    /// Are there no bytes?
    pub fn is_empty(&self) -> bool {
        self.length == 0
    }
}

impl fmt::Debug for HostBytes {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "HostBytes({} bytes)", self.length)
    }
}

impl PartialEq for HostBytes {
    /// The same value of the host
    fn eq(&self, other: &Self) -> bool {
        Rc::ptr_eq(&self.value, &other.value)
    }
}

impl Eq for HostBytes {}

/// Bytes that the module passes on: bytes in the module or bytes that stayed with the host
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Body {
    /// Bytes in the module
    Bytes(Vec<u8>),
    /// Bytes that stayed with the host
    Host(HostBytes),
}

impl Body {
    /// The number of bytes
    pub fn len(&self) -> usize {
        match self {
            Body::Bytes(bytes) => bytes.len(),
            Body::Host(bytes) => bytes.len(),
        }
    }

    /// Are there no bytes?
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// A response that the host received
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HttpResponse {
    /// The status code
    pub status: u16,
    /// The status text, e.g. `Not Found`, empty if the host doesn't know it
    pub status_text: String,
    /// The headers
    pub headers: Headers,
    /// The body, empty if it stayed with the host
    pub body: Vec<u8>,
    /// The body if it stayed with the host, see `executor::ExecutorHost::fetch_result`
    pub host_body: Option<HostBytes>,
}

impl HttpResponse {
    /// A response with a status and a body
    pub fn new(status: u16, body: impl Into<Vec<u8>>) -> Self {
        Self { status, status_text: String::new(), headers: Headers::new(), body: body.into(), host_body: None }
    }

    /// The response with a header, a value of a name that is set already is appended
    pub fn with_header(mut self, name: &str, value: &str) -> Self {
        self.headers.append(name, value);
        self
    }

    /// The response with a status text
    pub fn with_status_text(mut self, status_text: &str) -> Self {
        self.status_text = status_text.to_string();
        self
    }

    /// The value of a header, the name in any case. Several values are joined as `Headers.get` does.
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(name)
    }

    /// Is the status 2xx?
    pub fn is_success(&self) -> bool {
        (200..300).contains(&self.status)
    }

    /// Is the status 2xx, like `Response.ok`?
    pub fn ok(&self) -> bool {
        self.is_success()
    }

    /// The body as text, invalid UTF-8 replaced
    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }
}

/// How a request that the host sent went
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FetchOutcome {
    /// The server answered, with any status
    Response(HttpResponse),
    /// The request failed in the network, e.g. a refused connection
    NetworkError(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn headers_compare_names_without_case() {
        let mut headers = Headers::new();
        headers.set("x-a", "1");
        headers.set("X-A", "2");
        assert_eq!(headers.iter().collect::<Vec<_>>(), [("X-A", "2")]);
        headers.append("x-b", "1");
        headers.append("X-B", "2");
        assert_eq!(headers.get("x-B"), Some("1, 2"));
        headers.remove("X-b");
        assert!(!headers.has("x-b"));
        assert_eq!(headers.len(), 1);
    }

    #[test]
    fn methods_parse_in_any_case() {
        assert_eq!(HttpMethod::parse("post"), HttpMethod::Post);
        assert_eq!(HttpMethod::parse("purge"), HttpMethod::Other("PURGE".into()));
        assert_eq!(HttpMethod::parse("purge").as_str(), "PURGE");
        assert!(HttpMethod::Get == "GET");
    }
}

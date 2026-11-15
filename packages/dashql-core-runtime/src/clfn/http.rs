//! HTTP as data: the request that a protocol wants the host to send, and the response that the host hands back. The
//! host sends a request with its HTTP client (fetch, the proxy of the desktop app) and passes the response on.

/// A request for the host to send
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpRequest {
    /// The HTTP method
    pub method: String,
    /// The absolute URL
    pub url: String,
    /// The headers, in order
    pub headers: Vec<(String, String)>,
    /// The body
    pub body: Option<String>,
}

impl HttpRequest {
    /// The value of a header, whatever the case of its name
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(n, _)| n.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }
}

/// A response of a request
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct HttpResponse {
    /// The status
    pub status: u16,
    /// The text of the status, such as `OK`
    pub status_text: String,
    /// The headers
    pub headers: Vec<(String, String)>,
    /// The body as text
    pub body: String,
}

impl HttpResponse {
    /// A response with a status and a body
    pub fn new(status: u16, body: impl Into<String>) -> Self {
        Self { status, status_text: String::new(), headers: Vec::new(), body: body.into() }
    }

    /// The response with a header
    pub fn with_header(mut self, name: &str, value: &str) -> Self {
        self.headers.push((name.to_string(), value.to_string()));
        self
    }

    /// The value of a header, whatever the case of its name. Several values are joined as `Headers.get` does.
    pub fn header(&self, name: &str) -> Option<String> {
        let values: Vec<&str> =
            self.headers.iter().filter(|(n, _)| n.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str()).collect();
        (!values.is_empty()).then(|| values.join(", "))
    }

    /// Is the status a success?
    pub fn ok(&self) -> bool {
        (200..300).contains(&self.status)
    }
}

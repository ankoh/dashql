//! HTTP requests and responses as data, and the encodings that the Trino protocol needs: forms, URI components,
//! query params and base64.
//!
//! The host sends a request and reports how it went. The request carries no abort signal, the host drops the request
//! of a cancelled task and reports nothing.

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

/// A request that the host sends
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpRequest {
    /// The method
    pub method: HttpMethod,
    /// The absolute URL
    pub url: String,
    /// The headers in order, a name appears once
    pub headers: Vec<(String, String)>,
    /// The body, none for requests without
    pub body: Option<String>,
}

impl HttpRequest {
    /// A request without headers or body
    pub fn new(method: HttpMethod, url: impl Into<String>) -> Self {
        Self { method, url: url.into(), headers: Vec::new(), body: None }
    }

    /// Set a header, replacing a header of the same name regardless of its case
    pub fn set_header(&mut self, name: &str, value: impl Into<String>) {
        self.headers.retain(|(existing, _)| !existing.eq_ignore_ascii_case(name));
        self.headers.push((name.to_string(), value.into()));
    }

    /// The value of a header, the name in any case
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(existing, _)| existing.eq_ignore_ascii_case(name)).map(|(_, value)| value.as_str())
    }
}

/// A response that the host received
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct HttpResponse {
    /// The status code
    pub status: u16,
    /// The status text, e.g. `Not Found`, empty if the host doesn't know it
    pub status_text: String,
    /// The body
    pub body: Vec<u8>,
}

impl HttpResponse {
    /// A response with a status and a body
    pub fn new(status: u16, body: impl Into<Vec<u8>>) -> Self {
        Self { status, status_text: String::new(), body: body.into() }
    }

    /// Is the status 2xx?
    pub fn is_success(&self) -> bool {
        (200..300).contains(&self.status)
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
    /// The request failed in the network, e.g. a refused connection. Requests of query results are retried.
    NetworkError(String),
}

/// Encode a component of a URI like `encodeURIComponent`
pub fn encode_uri_component(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')' => {
                out.push(char::from(byte))
            }
            _ => push_percent(&mut out, byte),
        }
    }
    out
}

/// Encode a value of a form like `URLSearchParams` (`application/x-www-form-urlencoded`)
fn encode_form_value(text: &str, out: &mut String) {
    for byte in text.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'*' | b'-' | b'.' | b'_' => out.push(char::from(byte)),
            b' ' => out.push('+'),
            _ => push_percent(out, byte),
        }
    }
}

/// Append a percent-encoded byte
fn push_percent(out: &mut String, byte: u8) {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    out.push('%');
    out.push(char::from(HEX[usize::from(byte >> 4)]));
    out.push(char::from(HEX[usize::from(byte & 0xf)]));
}

/// Encode the fields of a form like `URLSearchParams.toString()`, in order
pub fn encode_form(fields: &[(&str, &str)]) -> String {
    let mut out = String::new();
    for (i, (name, value)) in fields.iter().enumerate() {
        if i > 0 {
            out.push('&');
        }
        encode_form_value(name, &mut out);
        out.push('=');
        encode_form_value(value, &mut out);
    }
    out
}

/// The parts of an absolute URL: everything before the path, the path, the query without `?` and the fragment with
/// `#`. None if the URL has no scheme and authority.
fn split_url(url: &str) -> Option<(&str, &str, Option<&str>, &str)> {
    let scheme_end = url.find("://")?;
    let scheme = url.get(..scheme_end)?;
    if scheme.is_empty() || !scheme.bytes().all(|b| b.is_ascii_alphanumeric() || b"+-.".contains(&b)) {
        return None;
    }
    let (rest, fragment) = match url.find('#') {
        Some(at) => url.split_at(at),
        None => (url, ""),
    };
    let (rest, query) = match rest.split_once('?') {
        Some((rest, query)) => (rest, Some(query)),
        None => (rest, None),
    };
    let authority_start = scheme_end + 3;
    let path_start = rest.get(authority_start..)?.find('/').map_or(rest.len(), |at| authority_start + at);
    Some((rest.get(..path_start)?, rest.get(path_start..)?, query, fragment))
}

/// The path of an absolute URL, none if the URL is not absolute
pub fn url_path(url: &str) -> Option<&str> {
    split_url(url).map(|(_, path, _, _)| path)
}

/// Set a query param of an absolute URL like `URL.searchParams.set`: earlier values of the param go, the new one is
/// appended. The other params stay as they are. None if the URL is not absolute.
pub fn set_query_param(url: &str, name: &str, value: &str) -> Option<String> {
    let (origin, path, query, fragment) = split_url(url)?;
    let mut params: Vec<String> = query
        .unwrap_or("")
        .split('&')
        .filter(|param| !param.is_empty() && param.split('=').next() != Some(name))
        .map(str::to_string)
        .collect();
    let mut param = String::new();
    encode_form_value(name, &mut param);
    param.push('=');
    encode_form_value(value, &mut param);
    params.push(param);
    Some(format!("{origin}{path}?{}{fragment}", params.join("&")))
}

/// The base64 alphabet
const BASE64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Encode bytes in base64 with padding, like `btoa`
pub fn base64_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk.first().copied().unwrap_or(0);
        let b1 = chunk.get(1).copied().unwrap_or(0);
        let b2 = chunk.get(2).copied().unwrap_or(0);
        let n = (u32::from(b0) << 16) | (u32::from(b1) << 8) | u32::from(b2);
        let symbol = |shift: u32| char::from(BASE64[((n >> shift) & 63) as usize]);
        out.push(symbol(18));
        out.push(symbol(12));
        out.push(if chunk.len() > 1 { symbol(6) } else { '=' });
        out.push(if chunk.len() > 2 { symbol(0) } else { '=' });
    }
    out
}

/// Decode base64 like `atob`: ASCII whitespace is skipped and the padding is optional. None if the text is no
/// base64.
pub fn base64_decode(text: &str) -> Option<Vec<u8>> {
    let mut symbols: Vec<u8> = text.bytes().filter(|b| !matches!(b, b' ' | b'\t' | b'\n' | b'\x0c' | b'\r')).collect();
    if symbols.len() % 4 == 0 {
        // Up to two padding characters at the end
        for _ in 0..2 {
            if symbols.last() == Some(&b'=') {
                symbols.pop();
            }
        }
    }
    if symbols.len() % 4 == 1 {
        return None;
    }
    let mut out = Vec::with_capacity(symbols.len() * 3 / 4);
    let mut buffer = 0u32;
    let mut bits = 0u32;
    for symbol in symbols {
        let value = match symbol {
            b'A'..=b'Z' => symbol - b'A',
            b'a'..=b'z' => symbol - b'a' + 26,
            b'0'..=b'9' => symbol - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        };
        buffer = (buffer << 6) | u32::from(value);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((buffer >> bits) & 0xff) as u8);
        }
    }
    Some(out)
}

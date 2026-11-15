//! The base url of a Hyper endpoint: its scheme, host and port. The HTTP API lives at absolute paths, so the path of an
//! endpoint doesn't matter, like `new URL("/api/v3/query", endpoint)` in the TypeScript.

use super::error::HyperError;

/// The scheme, host and port of an url
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BaseUrl {
    /// The scheme in lower case, e.g. `https`
    scheme: String,
    /// The host in lower case, an IPv6 address with its brackets, e.g. `[::1]`
    host: String,
    /// The port, none for the default port of the scheme
    port: Option<u16>,
}

/// The default port of a scheme
fn default_port(scheme: &str) -> Option<u16> {
    match scheme {
        "http" | "ws" => Some(80),
        "https" | "wss" => Some(443),
        "ftp" => Some(21),
        _ => None,
    }
}

impl BaseUrl {
    /// Parse an absolute url with an authority, e.g. `https://hyper.example:7484/api`
    pub fn parse(text: &str) -> Result<Self, HyperError> {
        let invalid = || HyperError::InvalidUrl(text.to_string());
        let text = text.trim_matches(|c: char| c <= ' ');
        let (scheme, rest) = text.split_once(':').ok_or_else(invalid)?;
        let mut scheme_chars = scheme.chars();
        let scheme_valid = scheme_chars.next().is_some_and(|c| c.is_ascii_alphabetic())
            && scheme_chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'));
        if !scheme_valid {
            return Err(invalid());
        }
        let scheme = scheme.to_ascii_lowercase();
        let rest = rest.strip_prefix("//").ok_or_else(invalid)?;
        let authority_end = rest.find(['/', '?', '#', '\\']).unwrap_or(rest.len());
        let authority = rest.get(..authority_end).ok_or_else(invalid)?;
        // The user info is no part of the origin
        let host_port = authority.rsplit_once('@').map_or(authority, |(_, host_port)| host_port);
        let (host, port) = if host_port.starts_with('[') {
            let close = host_port.find(']').ok_or_else(invalid)?;
            let host = host_port.get(..=close).ok_or_else(invalid)?;
            let after = host_port.get(close + 1..).ok_or_else(invalid)?;
            let port = match after {
                "" => None,
                _ => Some(after.strip_prefix(':').ok_or_else(invalid)?),
            };
            (host, port)
        } else {
            match host_port.split_once(':') {
                Some((host, port)) => (host, Some(port)),
                None => (host_port, None),
            }
        };
        let forbidden = |c: char| c.is_whitespace() || c.is_control() || "<>^|%\"`{}".contains(c);
        if host.is_empty() || host.contains(forbidden) {
            return Err(invalid());
        }
        let port = match port {
            None | Some("") => None,
            Some(port) => {
                if !port.chars().all(|c| c.is_ascii_digit()) {
                    return Err(invalid());
                }
                Some(port.parse::<u16>().map_err(|_| invalid())?)
            }
        };
        // The default port of the scheme is left out
        let port = port.filter(|port| Some(*port) != default_port(&scheme));
        Ok(Self { host: host.to_ascii_lowercase(), scheme, port })
    }

    /// The scheme, e.g. `https`
    pub fn scheme(&self) -> &str {
        &self.scheme
    }

    /// The host, e.g. `127.0.0.1` or `[::1]`
    pub fn host(&self) -> &str {
        &self.host
    }

    /// The port, none for the default port of the scheme
    pub fn port(&self) -> Option<u16> {
        self.port
    }

    /// The origin, e.g. `http://127.0.0.1:7484`
    pub fn origin(&self) -> String {
        match self.port {
            Some(port) => format!("{}://{}:{port}", self.scheme, self.host),
            None => format!("{}://{}", self.scheme, self.host),
        }
    }

    /// The url of an absolute path with query parameters
    pub fn join(&self, path: &str, query: &[(&str, String)]) -> String {
        let mut url = format!("{}{path}", self.origin());
        for (index, (name, value)) in query.iter().enumerate() {
            url.push(if index == 0 { '?' } else { '&' });
            url.push_str(&encode_form_component(name));
            url.push('=');
            url.push_str(&encode_form_component(value));
        }
        url
    }
}

/// Percent-encode a path segment like `encodeURIComponent`
pub fn encode_uri_component(text: &str) -> String {
    let mut encoded = String::with_capacity(text.len());
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            encoded.push(char::from(byte));
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

/// Encode a query parameter like `URLSearchParams`
fn encode_form_component(text: &str) -> String {
    let mut encoded = String::with_capacity(text.len());
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || b"*-._".contains(&byte) {
            encoded.push(char::from(byte));
        } else if byte == b' ' {
            encoded.push('+');
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

/// Decode the percent-encoding of a text like `decodeURIComponent`, none if a sequence is malformed or isn't UTF-8
pub fn decode_uri_component(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while let Some(&byte) = bytes.get(index) {
        if byte == b'%' {
            let hex = bytes.get(index + 1..index + 3)?;
            if !hex.iter().all(u8::is_ascii_hexdigit) {
                return None;
            }
            let hex = std::str::from_utf8(hex).ok()?;
            decoded.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            decoded.push(byte);
            index += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

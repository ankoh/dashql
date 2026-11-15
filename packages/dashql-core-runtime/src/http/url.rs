//! URLs as far as the requests of the runtime need them: parsing an absolute URL, resolving a URL of a response against
//! its base, the origin and the text, and the encodings of URL components and forms.
//!
//! `Url` follows the URL parser of the browsers where it matters for the origin check of client functions: a backslash
//! is a slash in a special URL, any number of slashes start its authority, dot segments resolve, the default port is no
//! port, an IPv6 host keeps its brackets. `Url::parse` takes HTTP and HTTPS URLs, `Url::parse_with_authority` any
//! scheme with an authority, e.g. the endpoint of a Hyper. The functions on the text of a URL (`url_path`,
//! `set_query_param`) leave the rest of the text as it is, the Trino protocol follows the URIs of the server verbatim.

use std::fmt;

/// A URL with a scheme and an authority
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Url {
    /// The scheme in lower case, e.g. `https`
    scheme: String,
    /// The user and password before the `@`, the origin leaves them out
    userinfo: Option<String>,
    /// The host in lower case, an IPv6 address with its brackets, e.g. `[::1]`
    host: String,
    /// The port, none for the default port of the scheme
    port: Option<u16>,
    /// The path, `/` at least
    path: String,
    /// The query without the `?`
    query: Option<String>,
    /// The fragment without the `#`
    fragment: Option<String>,
}

/// A URL that can't be parsed
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvalidUrl(pub String);

impl fmt::Display for InvalidUrl {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "invalid URL {}", self.0)
    }
}

impl std::error::Error for InvalidUrl {}

/// Does a text start with a scheme and a colon? Returns the scheme and the rest.
fn split_scheme(input: &str) -> Option<(&str, &str)> {
    let (scheme, rest) = input.split_once(':')?;
    let mut chars = scheme.chars();
    let valid = chars.next().is_some_and(|c| c.is_ascii_alphabetic())
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'));
    valid.then_some((scheme, rest))
}

/// The default port of a special scheme
fn default_port(scheme: &str) -> Option<u16> {
    match scheme {
        "http" | "ws" => Some(80),
        "https" | "wss" => Some(443),
        "ftp" => Some(21),
        _ => None,
    }
}

/// Is a scheme special, one whose URLs the browsers parse with an authority?
fn is_special(scheme: &str) -> bool {
    default_port(scheme).is_some()
}

/// Strip what the URL parser ignores: leading and trailing spaces and controls, tabs and line breaks
fn clean(input: &str) -> String {
    input.trim_matches(|c: char| c <= ' ').chars().filter(|c| !matches!(c, '\t' | '\n' | '\r')).collect()
}

/// A backslash is a slash before the query of a special URL
fn backslashes_to_slashes(input: &str) -> String {
    let end = input.find(['?', '#']).unwrap_or(input.len());
    let (head, tail) = input.split_at(end);
    format!("{}{tail}", head.replace('\\', "/"))
}

/// Percent-encode the bytes that the URL parser encodes in a path or a query
fn encode_component(text: &str, path: bool) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        let encode = c <= ' '
            || c == '\u{7f}'
            || !c.is_ascii()
            || matches!(c, '"' | '<' | '>')
            || (path && matches!(c, '`' | '{' | '}' | '?' | '^'))
            || (!path && c == '\'');
        if encode {
            let mut buffer = [0u8; 4];
            for byte in c.encode_utf8(&mut buffer).bytes() {
                push_percent(&mut out, byte);
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Resolve the dot segments of a path
fn remove_dot_segments(path: &str) -> String {
    let mut segments: Vec<&str> = Vec::new();
    let parts: Vec<&str> = path.split('/').skip(1).collect();
    let last = parts.len().saturating_sub(1);
    for (i, part) in parts.iter().enumerate() {
        let dot = part.eq_ignore_ascii_case(".") || part.eq_ignore_ascii_case("%2e");
        let dots = matches!(part.to_ascii_lowercase().as_str(), ".." | ".%2e" | "%2e." | "%2e%2e");
        if dots {
            segments.pop();
            if i == last {
                segments.push("");
            }
        } else if dot {
            if i == last {
                segments.push("");
            }
        } else {
            segments.push(part);
        }
    }
    format!("/{}", segments.join("/"))
}

/// Split the path, query and fragment of a text after the authority
fn split_path(rest: &str) -> (String, Option<String>, Option<String>) {
    let (rest, fragment) = match rest.split_once('#') {
        Some((rest, fragment)) => (rest, Some(fragment.to_string())),
        None => (rest, None),
    };
    let (path, query) = match rest.split_once('?') {
        Some((path, query)) => (path, Some(encode_component(query, false))),
        None => (rest, None),
    };
    let path = if path.is_empty() { "/".to_string() } else { remove_dot_segments(&encode_component(path, true)) };
    (path, query, fragment)
}

/// Split the host and the port of an authority without its user info. An IPv6 host keeps its brackets.
fn split_host_port(host_port: &str) -> Option<(&str, Option<&str>)> {
    if host_port.starts_with('[') {
        let close = host_port.find(']')?;
        let host = host_port.get(..=close)?;
        let after = host_port.get(close + 1..)?;
        let port = match after {
            "" => None,
            _ => Some(after.strip_prefix(':')?),
        };
        return Some((host, port));
    }
    Some(match host_port.split_once(':') {
        Some((host, port)) => (host, Some(port)),
        None => (host_port, None),
    })
}

/// The characters that no host contains
fn forbidden_in_host(c: char) -> bool {
    c <= ' ' || c.is_control() || matches!(c, '<' | '>' | '^' | '|' | '%' | '\\' | '/' | '?' | '#' | '@' | '"' | '`' | '{' | '}' | '[' | ']')
}

impl Url {
    /// Parse an absolute HTTP or HTTPS URL
    pub fn parse(input: &str) -> Result<Url, InvalidUrl> {
        let url = Url::parse_with_authority(input)?;
        if url.scheme != "http" && url.scheme != "https" {
            return Err(InvalidUrl(input.to_string()));
        }
        Ok(url)
    }

    /// Parse an absolute URL with an authority of any scheme, e.g. `https://hyper.example:7484/api`. A URL of a
    /// special scheme (HTTP, HTTPS, WS, WSS, FTP) is parsed as the browsers do, another one needs two slashes before
    /// its authority.
    pub fn parse_with_authority(input: &str) -> Result<Url, InvalidUrl> {
        let invalid = || InvalidUrl(input.to_string());
        let cleaned = clean(input);
        let (scheme, rest) = split_scheme(&cleaned).ok_or_else(invalid)?;
        let scheme = scheme.to_ascii_lowercase();
        let rest = if is_special(&scheme) {
            // Any number of slashes start the authority
            backslashes_to_slashes(rest).trim_start_matches('/').to_string()
        } else {
            rest.strip_prefix("//").ok_or_else(invalid)?.to_string()
        };
        let end = rest.find(['/', '?', '#', '\\']).unwrap_or(rest.len());
        let (authority, rest) = rest.split_at(end);
        let (userinfo, host_port) = match authority.rsplit_once('@') {
            Some((userinfo, host_port)) => (Some(userinfo.to_string()).filter(|u| !u.is_empty()), host_port),
            None => (None, authority),
        };
        let (host, port) = split_host_port(host_port).ok_or_else(invalid)?;
        let port = match port {
            None | Some("") => None,
            Some(port) => {
                if !port.chars().all(|c| c.is_ascii_digit()) {
                    return Err(invalid());
                }
                let port: u16 = port.parse().map_err(|_| invalid())?;
                // The default port of the scheme is left out
                Some(port).filter(|port| Some(*port) != default_port(&scheme))
            }
        };
        let valid_host = match host.strip_prefix('[').and_then(|host| host.strip_suffix(']')) {
            Some(address) => !address.is_empty() && address.chars().all(|c| c.is_ascii_hexdigit() || matches!(c, ':' | '.')),
            None => !host.is_empty() && !host.chars().any(forbidden_in_host),
        };
        if !valid_host {
            return Err(invalid());
        }
        let (path, query, fragment) = split_path(rest);
        Ok(Url { scheme, userinfo, host: host.to_lowercase(), port, path, query, fragment })
    }

    /// Resolve a URL against this one, as `new URL(reference, base)` does
    pub fn join(&self, reference: &str) -> Result<Url, InvalidUrl> {
        let cleaned = backslashes_to_slashes(&clean(reference));
        if let Some((scheme, rest)) = split_scheme(&cleaned) {
            // A URL of the same scheme without two slashes is relative, as in browsers
            if !scheme.eq_ignore_ascii_case(&self.scheme) || rest.starts_with("//") {
                return Url::parse(&cleaned);
            }
            return self.join(rest);
        }
        if cleaned.starts_with("//") {
            return Url::parse(&format!("{}:{cleaned}", self.scheme));
        }
        let mut url = Url { fragment: None, ..self.clone() };
        if cleaned.is_empty() {
            return Ok(url);
        }
        if let Some(fragment) = cleaned.strip_prefix('#') {
            url.fragment = Some(fragment.to_string());
            return Ok(url);
        }
        if cleaned.starts_with('?') {
            let (_, query, fragment) = split_path(&format!("/{cleaned}"));
            url.query = query;
            url.fragment = fragment;
            return Ok(url);
        }
        let merged = if cleaned.starts_with('/') {
            cleaned
        } else {
            let directory = self.path.rsplit_once('/').map_or("", |(directory, _)| directory);
            format!("{directory}/{cleaned}")
        };
        let (path, query, fragment) = split_path(&merged);
        url.path = path;
        url.query = query;
        url.fragment = fragment;
        Ok(url)
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
    /// Does the URL carry a user or a password?
    pub fn has_credentials(&self) -> bool {
        self.userinfo.is_some()
    }
    /// The path
    pub fn path(&self) -> &str {
        &self.path
    }
    /// The query without the `?`
    pub fn query(&self) -> Option<&str> {
        self.query.as_deref()
    }
    /// The fragment without the `#`
    pub fn fragment(&self) -> Option<&str> {
        self.fragment.as_deref()
    }

    /// The origin: scheme, host and a port that isn't the default
    pub fn origin(&self) -> String {
        match self.port {
            Some(port) => format!("{}://{}:{port}", self.scheme, self.host),
            None => format!("{}://{}", self.scheme, self.host),
        }
    }

    /// The URL with another path, percent-encoded like the `pathname` setter does
    pub fn with_path(&self, path: &str) -> Url {
        let encoded = encode_component(path, true);
        let path = if encoded.starts_with('/') { encoded } else { format!("/{encoded}") };
        Url { path, ..self.clone() }
    }

    /// The URL with pairs appended to its query, encoded as `URLSearchParams` does
    pub fn with_query_pairs(&self, pairs: &[(String, String)]) -> Url {
        if pairs.is_empty() {
            return self.clone();
        }
        let added = form_encode(pairs.iter().map(|(n, v)| (n.as_str(), v.as_str())));
        let query = match self.query.as_deref() {
            Some(existing) if !existing.is_empty() => format!("{existing}&{added}"),
            _ => added,
        };
        Url { query: Some(query), ..self.clone() }
    }

    /// The text of an absolute path with query params on the origin, like `new URL(path, origin)` with the params of
    /// `URLSearchParams`. The path of the URL doesn't matter, the path must be encoded already.
    pub fn origin_url(&self, path: &str, query: &[(&str, String)]) -> String {
        let mut url = format!("{}{path}", self.origin());
        for (index, (name, value)) in query.iter().enumerate() {
            url.push(if index == 0 { '?' } else { '&' });
            url.push_str(&form_encode_component(name));
            url.push('=');
            url.push_str(&form_encode_component(value));
        }
        url
    }
}

impl fmt::Display for Url {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}://", self.scheme)?;
        if let Some(userinfo) = &self.userinfo {
            write!(f, "{userinfo}@")?;
        }
        write!(f, "{}", self.host)?;
        if let Some(port) = self.port {
            write!(f, ":{port}")?;
        }
        write!(f, "{}", self.path)?;
        if let Some(query) = &self.query {
            write!(f, "?{query}")?;
        }
        if let Some(fragment) = &self.fragment {
            write!(f, "#{fragment}")?;
        }
        Ok(())
    }
}

/// Append a percent-encoded byte
fn push_percent(out: &mut String, byte: u8) {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    out.push('%');
    out.push(char::from(HEX[usize::from(byte >> 4)]));
    out.push(char::from(HEX[usize::from(byte & 0xf)]));
}

/// Percent-encode a string as `encodeURIComponent` does
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

/// Encode one name or value of `application/x-www-form-urlencoded`, as `URLSearchParams` does
pub fn form_encode_component(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'*' | b'-' | b'.' | b'_' => out.push(char::from(byte)),
            b' ' => out.push('+'),
            _ => push_percent(&mut out, byte),
        }
    }
    out
}

/// Encode pairs as `application/x-www-form-urlencoded` in order, as `new URLSearchParams(pairs).toString()` does
pub fn form_encode<'a>(pairs: impl IntoIterator<Item = (&'a str, &'a str)>) -> String {
    pairs
        .into_iter()
        .map(|(name, value)| format!("{}={}", form_encode_component(name), form_encode_component(value)))
        .collect::<Vec<_>>()
        .join("&")
}

/// The parts of the text of an absolute URL: everything before the path, the path, the query without `?` and the
/// fragment with `#`. None if the URL has no scheme and authority.
fn split_url_text(url: &str) -> Option<(&str, &str, Option<&str>, &str)> {
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

/// The path of the text of an absolute URL as it is written, none if the URL is not absolute
pub fn url_path(url: &str) -> Option<&str> {
    split_url_text(url).map(|(_, path, _, _)| path)
}

/// Set a query param of the text of an absolute URL like `URL.searchParams.set`: earlier values of the param go, the
/// new one is appended. The other params stay as they are written. None if the URL is not absolute.
pub fn set_query_param(url: &str, name: &str, value: &str) -> Option<String> {
    let (origin, path, query, fragment) = split_url_text(url)?;
    let mut params: Vec<String> = query
        .unwrap_or("")
        .split('&')
        .filter(|param| !param.is_empty() && param.split('=').next() != Some(name))
        .map(str::to_string)
        .collect();
    params.push(format!("{}={}", form_encode_component(name), form_encode_component(value)));
    Some(format!("{origin}{path}?{}{fragment}", params.join("&")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(text: &str) -> Url {
        Url::parse(text).unwrap()
    }

    #[test]
    fn parses_absolute_urls() {
        assert_eq!(url("https://Svc.Example.com").to_string(), "https://svc.example.com/");
        assert_eq!(url("https://svc.example.com:443/a").origin(), "https://svc.example.com");
        assert_eq!(url("http://svc.example.com:8080/a?b=1#c").to_string(), "http://svc.example.com:8080/a?b=1#c");
        assert_eq!(url("https://u:p@svc.example.com/").origin(), "https://svc.example.com");
        assert!(url("https://u:p@svc.example.com/").has_credentials());
        assert!(Url::parse("ftp://svc.example.com/").is_err());
        assert!(Url::parse("https:///").is_err());
        assert!(Url::parse("not a url").is_err());
    }

    #[test]
    fn resolves_like_the_browser() {
        let base = url("https://svc.example.com/v2/items");
        assert_eq!(base.join("/results/1?page=1").unwrap().to_string(), "https://svc.example.com/results/1?page=1");
        assert_eq!(base.join("next").unwrap().to_string(), "https://svc.example.com/v2/next");
        assert_eq!(base.join("../x").unwrap().to_string(), "https://svc.example.com/x");
        assert_eq!(base.join("/a/%2e%2e/b").unwrap().to_string(), "https://svc.example.com/b");
        assert_eq!(base.join("?a=1").unwrap().to_string(), "https://svc.example.com/v2/items?a=1");
        assert_eq!(base.join("//evil.example.com/x").unwrap().origin(), "https://evil.example.com");
        assert_eq!(base.join("/\\evil.example.com/x").unwrap().origin(), "https://evil.example.com");
        assert_eq!(base.join("https:/x").unwrap().to_string(), "https://svc.example.com/x");
        assert_eq!(base.join("http:/x").unwrap().to_string(), "http://x/");
        assert_eq!(base.join("https:x").unwrap().to_string(), "https://svc.example.com/v2/x");
        assert_eq!(base.join("http://svc.example.com/x").unwrap().origin(), "http://svc.example.com");
    }

    #[test]
    fn parses_urls_with_an_authority_of_any_scheme() {
        let parse = |text: &str| Url::parse_with_authority(text);
        assert_eq!(parse("https://hyper.example:443/some/path?x=1").unwrap().origin(), "https://hyper.example");
        assert_eq!(parse("http://127.0.0.1:7484").unwrap().origin(), "http://127.0.0.1:7484");
        let ipv6 = parse("https://[::1]:7484/").unwrap();
        assert_eq!((ipv6.host(), ipv6.port()), ("[::1]", Some(7484)));
        assert_eq!(parse("http://[::1]").unwrap().host(), "[::1]");
        assert_eq!(parse("grpc://Hyper.Example:7483").unwrap().origin(), "grpc://hyper.example:7483");
        assert_eq!(parse("wss://u@hyper.example:443").unwrap().origin(), "wss://hyper.example");
        assert!(parse("file:///tmp/hyperd").is_err());
        assert!(parse("grpc:hyper.example").is_err());
        assert!(parse("http://hyper.example:+80").is_err());
        assert!(parse("http://hyper.example:99999").is_err());
        assert!(parse("http://[::1").is_err());
        assert!(parse("http://hy per.example").is_err());
        assert!(parse("").is_err());
    }

    #[test]
    fn builds_urls_on_the_origin() {
        let url = Url::parse_with_authority("https://hyper.example/api").unwrap();
        assert_eq!(url.origin_url("/api/v3/query", &[]), "https://hyper.example/api/v3/query");
        assert_eq!(
            url.origin_url("/q", &[("waitTimeMs", "250".to_string()), ("a b", "c&d".to_string())]),
            "https://hyper.example/q?waitTimeMs=250&a+b=c%26d"
        );
    }

    #[test]
    fn encodes_like_the_browser() {
        assert_eq!(encode_uri_component("a b/c"), "a%20b%2Fc");
        assert_eq!(encode_uri_component("%2e"), "%252e");
        assert_eq!(form_encode([("dataspace", "Marketing Space"), ("a[b]", "ü")]), "dataspace=Marketing+Space&a%5Bb%5D=%C3%BC");
        assert_eq!(decode_uri_component("a%20b%2Fc").as_deref(), Some("a b/c"));
        assert_eq!(decode_uri_component("%zz"), None);
        assert_eq!(decode_uri_component("%C3"), None);
    }

    #[test]
    fn edits_the_text_of_a_url() {
        let next = "https://trino.example.com/v1/statement/executing/q1/y1/1?a=1&targetResultSize=1MB#f";
        assert_eq!(url_path(next), Some("/v1/statement/executing/q1/y1/1"));
        assert_eq!(url_path("/relative"), None);
        assert_eq!(
            set_query_param(next, "targetResultSize", "32MB").as_deref(),
            Some("https://trino.example.com/v1/statement/executing/q1/y1/1?a=1&targetResultSize=32MB#f")
        );
    }
}

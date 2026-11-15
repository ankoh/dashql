//! HTTP and HTTPS URLs, as far as the requests of the runtime need them: parsing an absolute URL, resolving a URL of a
//! response against its host, the origin and the text. It follows the URL parser of the browsers where it matters
//! for the origin check: a backslash is a slash, any number of slashes start the authority, dot segments resolve, and
//! the default port is no port.

use std::fmt;

/// A URL of HTTP or HTTPS
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Url {
    /// `http` or `https`
    scheme: String,
    /// The user and password before the `@`, the origin leaves them out
    userinfo: Option<String>,
    /// The host in lower case
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

/// Does a text start with a scheme and a colon? Returns the scheme and the rest.
fn split_scheme(input: &str) -> Option<(&str, &str)> {
    let (scheme, rest) = input.split_once(':')?;
    let mut chars = scheme.chars();
    let valid = chars.next().is_some_and(|c| c.is_ascii_alphabetic())
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'));
    valid.then_some((scheme, rest))
}

/// The default port of a scheme
fn default_port(scheme: &str) -> u16 {
    if scheme == "http" {
        80
    } else {
        443
    }
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
        let encode = c <= ' ' || c == '\u{7f}' || !c.is_ascii() || matches!(c, '"' | '<' | '>')
            || (path && matches!(c, '`' | '{' | '}' | '?' | '^'))
            || (!path && c == '\'');
        if encode {
            let mut buffer = [0u8; 4];
            for byte in c.encode_utf8(&mut buffer).bytes() {
                out.push_str(&format!("%{byte:02X}"));
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

impl Url {
    /// Parse an absolute HTTP or HTTPS URL
    pub fn parse(input: &str) -> Result<Url, InvalidUrl> {
        let invalid = || InvalidUrl(input.to_string());
        let cleaned = clean(input);
        let (scheme, rest) = split_scheme(&cleaned).ok_or_else(invalid)?;
        let scheme = scheme.to_ascii_lowercase();
        if scheme != "http" && scheme != "https" {
            return Err(invalid());
        }
        let rest = backslashes_to_slashes(rest);
        // Any number of slashes start the authority
        let rest = rest.trim_start_matches('/');
        let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
        let (authority, rest) = rest.split_at(end);
        let (userinfo, host_port) = match authority.rsplit_once('@') {
            Some((userinfo, host_port)) => (Some(userinfo.to_string()).filter(|u| !u.is_empty()), host_port),
            None => (None, authority),
        };
        let (host, port) = match host_port.rsplit_once(':').filter(|(_, port)| !port.contains(']')) {
            Some((host, "")) => (host, None),
            Some((host, port)) => {
                let port: u16 = port.parse().map_err(|_| invalid())?;
                (host, Some(port).filter(|p| *p != default_port(&scheme)))
            }
            None => (host_port, None),
        };
        let forbidden = |c: char| c <= ' ' || matches!(c, '<' | '>' | '^' | '|' | '%' | '\\' | '/' | '?' | '#' | '@');
        if host.is_empty() || host.chars().any(forbidden) {
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

    /// The scheme, `http` or `https`
    pub fn scheme(&self) -> &str {
        &self.scheme
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
        let added = super::json::form_encode(pairs.iter().map(|(n, v)| (n.as_str(), v.as_str())));
        let query = match self.query.as_deref() {
            Some(existing) if !existing.is_empty() => format!("{existing}&{added}"),
            _ => added,
        };
        Url { query: Some(query), ..self.clone() }
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
}

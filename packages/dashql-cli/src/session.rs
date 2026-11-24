//! The session file that DashQL writes into the folder of a workbook: where the app listens for the calls of the agent

use serde_json::Value;

/// The address of the app and the workbook of the agent
#[derive(Debug, PartialEq, Eq)]
pub struct Session {
    /// The host of the server of the app, a loopback address
    pub host: String,
    pub port: u16,
    pub token: String,
    pub workbook_id: String,
}

/// The host and port of a loopback URL `http://127.0.0.1:<port>`
fn loopback(url: &str) -> Option<(String, u16)> {
    let rest = url.strip_prefix("http://")?.trim_end_matches('/');
    let (host, port) = rest.rsplit_once(':')?;
    if host != "127.0.0.1" && host != "localhost" {
        return None;
    }
    let port = port.parse::<u16>().ok().filter(|port| *port != 0)?;
    Some((host.to_string(), port))
}

/// Parse the text of a session file
pub fn parse_session(text: &str) -> Result<Session, String> {
    let value: Value = serde_json::from_str(text).map_err(|e| format!("not JSON: {e}"))?;
    let field =
        |name: &str| value.get(name).and_then(Value::as_str).filter(|s| !s.is_empty()).ok_or(format!("no {name}"));
    let url = field("url")?;
    let (host, port) = loopback(url).ok_or(format!("the url {url} is no loopback address"))?;
    Ok(Session { host, port, token: field("token")?.to_string(), workbook_id: field("workbookId")?.to_string() })
}

/// Read a session file
pub fn read_session(path: &str) -> Result<Session, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("the session file {path}: {e}"))?;
    parse_session(&text).map_err(|e| format!("the session file {path}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_address_the_token_and_the_workbook() {
        let session = parse_session(r#"{"url": "http://127.0.0.1:4321", "token": "t", "workbookId": "w"}"#).unwrap();
        assert_eq!(
            session,
            Session { host: "127.0.0.1".into(), port: 4321, token: "t".into(), workbook_id: "w".into() }
        );
        assert_eq!(
            parse_session(r#"{"url": "http://localhost:1/", "token": "t", "workbookId": "w"}"#).unwrap().port,
            1
        );
    }

    #[test]
    fn rejects_broken_session_files() {
        for (text, error) in [
            ("{", "not JSON"),
            (r#"{"token": "t", "workbookId": "w"}"#, "no url"),
            (r#"{"url": "http://127.0.0.1:1", "workbookId": "w"}"#, "no token"),
            (r#"{"url": "http://127.0.0.1:1", "token": "", "workbookId": "w"}"#, "no token"),
            (r#"{"url": "http://127.0.0.1:1", "token": "t"}"#, "no workbookId"),
            (r#"{"url": "https://127.0.0.1:1", "token": "t", "workbookId": "w"}"#, "no loopback"),
            (r#"{"url": "http://example.com:1", "token": "t", "workbookId": "w"}"#, "no loopback"),
            (r#"{"url": "http://127.0.0.1:x", "token": "t", "workbookId": "w"}"#, "no loopback"),
            (r#"{"url": "http://127.0.0.1:0", "token": "t", "workbookId": "w"}"#, "no loopback"),
        ] {
            let message = parse_session(text).unwrap_err();
            assert!(message.contains(error), "{text}: {message}");
        }
    }

    #[test]
    fn names_a_missing_file() {
        let error = read_session("/nonexistent/session.json").unwrap_err();
        assert!(error.starts_with("the session file /nonexistent/session.json: "), "{error}");
    }
}

//! The little HTTP/1.1 that the agent server and the command line tool speak.
//! Every exchange is one request and one response on its own connection.

use tokio::io::{AsyncRead, AsyncReadExt};

/// The size limit of a request head
const MAX_HEAD_BYTES: usize = 64 * 1024;

/// The head of a request
#[derive(Debug)]
pub struct Request {
    pub method: String,
    /// The request target, e.g. `/v1/call?x=1`
    pub target: String,
    /// The headers with lowercase names
    pub headers: Vec<(String, String)>,
    /// The bytes after the head that were read with it
    pub rest: Vec<u8>,
}

impl Request {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(n, _)| n == name).map(|(_, v)| v.as_str())
    }

    /// The target without its query
    pub fn path(&self) -> &str {
        self.target.split('?').next().unwrap_or_default()
    }
}

/// Read the head of a request, None if the peer closed the connection before sending one
pub async fn read_request<S: AsyncRead + Unpin>(stream: &mut S) -> std::io::Result<Option<Request>> {
    let invalid = |message: &str| std::io::Error::new(std::io::ErrorKind::InvalidData, message.to_string());
    let mut buffer = Vec::new();
    let mut chunk = [0; 4096];
    loop {
        let n = stream.read(&mut chunk).await?;
        if n == 0 {
            return Ok(None);
        }
        buffer.extend_from_slice(&chunk[..n]);
        let mut headers = [httparse::EMPTY_HEADER; 64];
        let mut request = httparse::Request::new(&mut headers);
        match request.parse(&buffer).map_err(|e| invalid(&e.to_string()))? {
            httparse::Status::Complete(length) => {
                return Ok(Some(Request {
                    method: request.method.unwrap_or_default().to_string(),
                    target: request.path.unwrap_or_default().to_string(),
                    headers: request
                        .headers
                        .iter()
                        .map(|h| (h.name.to_ascii_lowercase(), String::from_utf8_lossy(h.value).into_owned()))
                        .collect(),
                    rest: buffer[length..].to_vec(),
                }));
            }
            httparse::Status::Partial if buffer.len() > MAX_HEAD_BYTES => {
                return Err(invalid("the request head is too big"))
            }
            httparse::Status::Partial => {}
        }
    }
}

/// Read the body of a request with a Content-Length, up to a limit
pub async fn read_body<S: AsyncRead + Unpin>(
    stream: &mut S,
    request: &Request,
    limit: usize,
) -> Result<Vec<u8>, String> {
    let length: usize = match request.header("content-length") {
        Some(length) => length.trim().parse().map_err(|_| "the content length is invalid".to_string())?,
        None => 0,
    };
    if length > limit {
        return Err("the request is too big".into());
    }
    let mut body = request.rest.clone();
    body.truncate(length);
    let mut remaining = (&mut *stream).take((length - body.len()) as u64);
    remaining.read_to_end(&mut body).await.map_err(|e| e.to_string())?;
    if body.len() < length {
        return Err("the request ended early".into());
    }
    Ok(body)
}

/// A response that closes the connection
pub fn response(status: u16, reason: &str, content_type: Option<&str>, body: &[u8]) -> Vec<u8> {
    let content_type =
        content_type.map(|t| format!("Content-Type: {t}\r\nCache-Control: no-store\r\n")).unwrap_or_default();
    let mut out = format!(
        "HTTP/1.1 {status} {reason}\r\n{content_type}Content-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    )
    .into_bytes();
    out.extend_from_slice(body);
    out
}

/// The status and the body of a complete response
pub fn parse_response(bytes: &[u8]) -> Option<(u16, &[u8])> {
    let mut headers = [httparse::EMPTY_HEADER; 64];
    let mut response = httparse::Response::new(&mut headers);
    match response.parse(bytes).ok()? {
        httparse::Status::Complete(length) => Some((response.code?, &bytes[length..])),
        httparse::Status::Partial => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn reads_requests_with_bodies() {
        let mut input: &[u8] = b"POST /v1/call?x HTTP/1.1\r\nHost: 127.0.0.1:1\r\nContent-Length: 5\r\n\r\nhello";
        let request = read_request(&mut input).await.unwrap().unwrap();
        assert_eq!((request.method.as_str(), request.path()), ("POST", "/v1/call"));
        assert_eq!(request.header("host"), Some("127.0.0.1:1"));
        assert_eq!(read_body(&mut input, &request, 100).await.unwrap(), b"hello");
        assert_eq!(read_body(&mut input, &request, 4).await.unwrap_err(), "the request is too big");
        assert!(read_request(&mut &b""[..]).await.unwrap().is_none());
    }

    #[test]
    fn writes_and_parses_responses() {
        let bytes = response(404, "Not Found", Some("application/json"), b"{}");
        assert_eq!(parse_response(&bytes), Some((404, &b"{}"[..])));
        assert_eq!(parse_response(b"HTTP/1.1 200 OK\r\n"), None);
    }
}

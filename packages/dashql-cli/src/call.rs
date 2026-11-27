//! A call of the page: one HTTP/1.0 request to the server of the app, its answer streamed as JSON lines. Node answers
//! a request of HTTP/1.0 neither chunked nor kept alive: the body is the rest of the stream until the app closes it.

use crate::session::Session;
use crate::{EXIT_FAILED, EXIT_USAGE};
use serde_json::Value;
use std::io::{BufRead, BufReader, Cursor, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::time::Duration;

/// The largest request that the server takes
pub const MAX_REQUEST_BYTES: usize = 16 * 1024 * 1024;
/// The largest head of an answer
const MAX_HEAD_BYTES: usize = 64 * 1024;
/// The largest error message of an answer that is read
const MAX_ERROR_BYTES: u64 = 1024 * 1024;
/// How long to wait for the app to take the connection
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

/// Where the answer goes
pub struct Output<'a> {
    pub stdout: &'a mut dyn Write,
    pub stderr: &'a mut dyn Write,
}

impl Output<'_> {
    /// Report an error, the exit code passes through
    fn error(&mut self, code: u8, message: &str) -> u8 {
        // A closed stderr leaves nothing to report on
        let _ = writeln!(self.stderr, "error: {message}");
        code
    }
}

/// The HTTP request of a call
fn request(session: &Session, body: &[u8]) -> Vec<u8> {
    let mut out = format!(
        "POST /v1/call HTTP/1.0\r\nHost: 127.0.0.1:{}\r\nAuthorization: Bearer {}\r\nContent-Type: application/json\r\n\
         Content-Length: {}\r\n\r\n",
        session.port,
        session.token,
        body.len()
    )
    .into_bytes();
    out.extend_from_slice(body);
    out
}

/// The status of an answer
struct Head {
    status: u16,
    reason: String,
}

/// Read the head of an answer, returns it with the bytes of the body read after it
fn read_head(stream: &mut dyn Read) -> Result<(Head, Vec<u8>), String> {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        let n = stream.read(&mut chunk).map_err(|e| format!("reading the answer: {e}"))?;
        if n == 0 {
            return Err("DashQL closed the connection without an answer".into());
        }
        buffer.extend_from_slice(chunk.get(..n).unwrap_or_default());
        let mut headers = [httparse::EMPTY_HEADER; 64];
        let mut response = httparse::Response::new(&mut headers);
        match response.parse(&buffer) {
            Ok(httparse::Status::Complete(end)) => {
                let head = Head {
                    status: response.code.unwrap_or_default(),
                    reason: response.reason.unwrap_or_default().to_string(),
                };
                let rest = buffer.get(end..).unwrap_or_default().to_vec();
                return Ok((head, rest));
            }
            Ok(httparse::Status::Partial) if buffer.len() < MAX_HEAD_BYTES => {}
            Ok(httparse::Status::Partial) => return Err("the head of the answer is too large".into()),
            Err(e) => return Err(format!("a malformed answer: {e}")),
        }
    }
}

/// Stream the JSON lines of an answer to the output, returns the exit code
fn stream_lines(body: &mut dyn Read, output: &mut Output) -> u8 {
    let mut reader = BufReader::new(body);
    let mut line = Vec::new();
    loop {
        line.clear();
        match reader.read_until(b'\n', &mut line) {
            Ok(0) => return output.error(EXIT_FAILED, "DashQL stopped answering"),
            Ok(_) => {}
            Err(_) => return output.error(EXIT_FAILED, "DashQL stopped answering"),
        }
        if line.iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        let Ok(message) = serde_json::from_slice::<Value>(&line) else {
            return output.error(EXIT_FAILED, "DashQL answered with a malformed line");
        };
        if let Some(text) = message.get("out").and_then(Value::as_str) {
            // Flushed per line: a run prints its progress while it goes
            if output.stdout.write_all(text.as_bytes()).and_then(|_| output.stdout.flush()).is_err() {
                return EXIT_FAILED;
            }
        }
        if let Some(text) = message.get("err").and_then(Value::as_str) {
            if output.stderr.write_all(text.as_bytes()).and_then(|_| output.stderr.flush()).is_err() {
                return EXIT_FAILED;
            }
        }
        if let Some(code) = message.get("exit").and_then(Value::as_u64) {
            return u8::try_from(code).unwrap_or(EXIT_FAILED);
        }
    }
}

/// Send a call to the app and stream its answer, returns the exit code
pub fn send(session: &Session, body: &[u8], output: &mut Output) -> u8 {
    if body.len() > MAX_REQUEST_BYTES {
        return output.error(EXIT_USAGE, "the call is larger than 16 MiB");
    }
    let address = SocketAddr::from((Ipv4Addr::LOCALHOST, session.port));
    let mut stream = match TcpStream::connect_timeout(&address, CONNECT_TIMEOUT) {
        Ok(stream) => stream,
        Err(e) => {
            let message =
                format!("DashQL is not running or runs no question on this workbook: no answer on {address}: {e}");
            return output.error(EXIT_USAGE, &message);
        }
    };
    if let Err(e) = stream.write_all(&request(session, body)).and_then(|_| stream.flush()) {
        return output.error(EXIT_USAGE, &format!("sending the call to DashQL: {e}"));
    }
    let (head, rest) = match read_head(&mut stream) {
        Ok(head) => head,
        Err(e) => return output.error(EXIT_FAILED, &e),
    };
    // The body is the rest of the stream until the app closes it
    let mut body = Cursor::new(rest).chain(stream);
    if head.status != 200 {
        let mut message = Vec::new();
        let _ = (&mut body).take(MAX_ERROR_BYTES).read_to_end(&mut message);
        let message = String::from_utf8_lossy(&message).trim().to_string();
        let message =
            if message.is_empty() { format!("DashQL answered {} {}", head.status, head.reason) } else { message };
        return output.error(EXIT_USAGE, &message);
    }
    stream_lines(&mut body, output)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(body: &str) -> (u8, String, String) {
        let (mut stdout, mut stderr) = (Vec::new(), Vec::new());
        let code = stream_lines(&mut body.as_bytes(), &mut Output { stdout: &mut stdout, stderr: &mut stderr });
        (code, String::from_utf8(stdout).unwrap(), String::from_utf8(stderr).unwrap())
    }

    #[test]
    fn prints_the_lines_and_exits_with_the_code() {
        let body =
            "{\"out\": \"a\\n\"}\n{\"err\": \"warn\\n\"}\n\n{\"out\": \"b\\n\"}\n{\"exit\": 1}\n{\"out\": \"late\"}\n";
        assert_eq!(lines(body), (1, "a\nb\n".into(), "warn\n".into()));
        assert_eq!(lines("{\"exit\": 0}"), (0, "".into(), "".into()));
    }

    #[test]
    fn fails_an_answer_without_an_exit_code() {
        assert_eq!(lines("{\"out\": \"a\\n\"}\n"), (1, "a\n".into(), "error: DashQL stopped answering\n".into()));
        assert_eq!(lines("not json\n"), (1, "".into(), "error: DashQL answered with a malformed line\n".into()));
    }

    #[test]
    fn writes_the_request_with_the_token() {
        let session = Session { port: 9, token: "secret".into(), workbook_id: "w".into() };
        let request = String::from_utf8(request(&session, b"{}")).unwrap();
        assert!(request.starts_with("POST /v1/call HTTP/1.0\r\nHost: 127.0.0.1:9\r\n"), "{request}");
        assert!(request.contains("\r\nAuthorization: Bearer secret\r\n"));
        assert!(request.ends_with("\r\nContent-Length: 2\r\n\r\n{}"), "{request}");
    }
}

//! A call of the page: one HTTP request to the server of the app, its answer streamed as JSON lines

use crate::session::Session;
use crate::{EXIT_FAILED, EXIT_USAGE};
use serde_json::Value;
use std::io::{BufRead, BufReader, Cursor, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
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
        "POST /v1/call HTTP/1.1\r\nHost: {}:{}\r\nAuthorization: Bearer {}\r\nContent-Type: application/json\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n",
        session.host,
        session.port,
        session.token,
        body.len()
    )
    .into_bytes();
    out.extend_from_slice(body);
    out
}

/// The status and the framing of the body of an answer
struct Head {
    status: u16,
    reason: String,
    chunked: bool,
    length: Option<u64>,
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
                let mut head = Head {
                    status: response.code.unwrap_or_default(),
                    reason: response.reason.unwrap_or_default().to_string(),
                    chunked: false,
                    length: None,
                };
                for header in response.headers.iter() {
                    let value = String::from_utf8_lossy(header.value);
                    if header.name.eq_ignore_ascii_case("transfer-encoding") {
                        head.chunked = value.to_ascii_lowercase().contains("chunked");
                    } else if header.name.eq_ignore_ascii_case("content-length") {
                        head.length = value.trim().parse().ok();
                    }
                }
                let rest = buffer.get(end..).unwrap_or_default().to_vec();
                return Ok((head, rest));
            }
            Ok(httparse::Status::Partial) if buffer.len() < MAX_HEAD_BYTES => {}
            Ok(httparse::Status::Partial) => return Err("the head of the answer is too large".into()),
            Err(e) => return Err(format!("a malformed answer: {e}")),
        }
    }
}

/// The body of a chunked answer
struct Chunked<R: BufRead> {
    inner: R,
    /// The bytes left of the current chunk
    left: u64,
    done: bool,
}

impl<R: BufRead> Chunked<R> {
    fn line(&mut self) -> std::io::Result<String> {
        let mut line = String::new();
        self.inner.read_line(&mut line)?;
        Ok(line)
    }
}

impl<R: BufRead> Read for Chunked<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if self.done || buf.is_empty() {
            return Ok(0);
        }
        if self.left == 0 {
            let line = self.line()?;
            if line.is_empty() {
                return Err(std::io::Error::new(std::io::ErrorKind::UnexpectedEof, "the answer ended in a chunk"));
            }
            let size = line.trim().split(';').next().unwrap_or_default();
            self.left = u64::from_str_radix(size, 16)
                .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidData, "a malformed chunk"))?;
            if self.left == 0 {
                self.done = true;
                return Ok(0);
            }
        }
        let want = usize::try_from(self.left).unwrap_or(usize::MAX).min(buf.len());
        let n = self.inner.read(buf.get_mut(..want).unwrap_or_default())?;
        if n == 0 {
            return Err(std::io::Error::new(std::io::ErrorKind::UnexpectedEof, "the answer ended in a chunk"));
        }
        self.left -= n as u64;
        if self.left == 0 {
            // The line break after the data of a chunk
            self.line()?;
        }
        Ok(n)
    }
}

/// The body of an answer as a reader
fn body_reader<'a>(head: &Head, rest: Vec<u8>, stream: Box<dyn Read + 'a>) -> Box<dyn Read + 'a> {
    let inner = Cursor::new(rest).chain(stream);
    if head.chunked {
        Box::new(Chunked { inner: BufReader::new(inner), left: 0, done: false })
    } else if let Some(length) = head.length {
        Box::new(inner.take(length))
    } else {
        Box::new(inner)
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
    let address = format!("{}:{}", session.host, session.port);
    let not_running = |e: &dyn std::fmt::Display| {
        format!("DashQL is not running or runs no question on this workbook: no answer on {address}: {e}")
    };
    let resolved = match address.to_socket_addrs() {
        Ok(mut addresses) => addresses.next(),
        Err(e) => return output.error(EXIT_USAGE, &not_running(&e)),
    };
    let Some(resolved) = resolved else {
        return output.error(EXIT_USAGE, &not_running(&"no address"));
    };
    let mut stream = match TcpStream::connect_timeout(&resolved, CONNECT_TIMEOUT) {
        Ok(stream) => stream,
        Err(e) => return output.error(EXIT_USAGE, &not_running(&e)),
    };
    if let Err(e) = stream.write_all(&request(session, body)).and_then(|_| stream.flush()) {
        return output.error(EXIT_USAGE, &format!("sending the call to DashQL: {e}"));
    }
    let (head, rest) = match read_head(&mut stream) {
        Ok(head) => head,
        Err(e) => return output.error(EXIT_FAILED, &e),
    };
    let mut body = body_reader(&head, rest, Box::new(stream));
    if head.status != 200 {
        let mut message = Vec::new();
        let _ = body.take(MAX_ERROR_BYTES).read_to_end(&mut message);
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
    fn reads_a_chunked_body() {
        let wire = "5\r\nhello\r\n7;ext=1\r\n world!\r\n0\r\n\r\n";
        let mut chunked = Chunked { inner: BufReader::new(wire.as_bytes()), left: 0, done: false };
        let mut text = String::new();
        chunked.read_to_string(&mut text).unwrap();
        assert_eq!(text, "hello world!");
        let mut cut = Chunked { inner: BufReader::new("5\r\nhel".as_bytes()), left: 0, done: false };
        assert!(cut.read_to_string(&mut String::new()).is_err());
    }

    #[test]
    fn writes_the_request_with_the_token() {
        let session = Session { host: "127.0.0.1".into(), port: 9, token: "secret".into(), workbook_id: "w".into() };
        let request = String::from_utf8(request(&session, b"{}")).unwrap();
        assert!(request.starts_with("POST /v1/call HTTP/1.1\r\nHost: 127.0.0.1:9\r\n"), "{request}");
        assert!(request.contains("\r\nAuthorization: Bearer secret\r\n"));
        assert!(request.ends_with("\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}"), "{request}");
    }
}

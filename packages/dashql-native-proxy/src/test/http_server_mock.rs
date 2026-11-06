use std::net::SocketAddr;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

/// A request the server received
#[derive(Debug)]
pub struct ReceivedRequest {
    /// The request line, e.g. `POST /path?a=1 HTTP/1.1`
    pub line: String,
    /// The headers with lowercase names
    pub headers: Vec<(String, String)>,
    /// The body
    pub body: Vec<u8>,
}

impl ReceivedRequest {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(key, _)| key == name).map(|(_, value)| value.as_str())
    }
}

/// The connection of a received request, a test writes the response by hand to control its timing
pub struct Connection(pub TcpStream);

impl Connection {
    pub async fn write(&mut self, text: &str) {
        self.0.write_all(text.as_bytes()).await.unwrap();
        self.0.flush().await.unwrap();
    }

    /// Start a chunked response
    pub async fn write_head(&mut self, status: &str, headers: &[(&str, &str)]) {
        let headers: String = headers.iter().map(|(key, value)| format!("{key}: {value}\r\n")).collect();
        self.write(&format!("HTTP/1.1 {status}\r\ntransfer-encoding: chunked\r\n{headers}\r\n")).await;
    }

    pub async fn write_chunk(&mut self, chunk: &str) {
        self.write(&format!("{:x}\r\n{chunk}\r\n", chunk.len())).await;
    }

    pub async fn finish(&mut self) {
        self.write("0\r\n\r\n").await;
    }

    /// Wait until the client closes the connection
    pub async fn closed(&mut self) {
        let mut buffer = [0; 1024];
        while !matches!(self.0.read(&mut buffer).await, Ok(0) | Err(_)) {}
    }
}

/// An HTTP server that hands every request and its connection to the test
pub async fn spawn_http_server() -> (SocketAddr, tokio::sync::mpsc::Receiver<(ReceivedRequest, Connection)>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (sender, receiver) = tokio::sync::mpsc::channel(4);
    tokio::spawn(async move {
        while let Ok((mut stream, _)) = listener.accept().await {
            let sender = sender.clone();
            tokio::spawn(async move {
                let mut buffer = Vec::new();
                let head_end = loop {
                    if let Some(position) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
                        break position;
                    }
                    let mut chunk = [0; 4096];
                    match stream.read(&mut chunk).await {
                        Ok(0) | Err(_) => return,
                        Ok(read) => buffer.extend_from_slice(&chunk[..read]),
                    }
                };
                let head = String::from_utf8_lossy(&buffer[..head_end]).to_string();
                let mut lines = head.split("\r\n");
                let line = lines.next().unwrap().to_string();
                let headers: Vec<(String, String)> = lines
                    .filter_map(|line| line.split_once(':'))
                    .map(|(key, value)| (key.trim().to_lowercase(), value.trim().to_string()))
                    .collect();
                let length: usize = headers.iter()
                    .find(|(key, _)| key == "content-length")
                    .map_or(0, |(_, value)| value.parse().unwrap());
                let mut body = buffer[head_end + 4..].to_vec();
                while body.len() < length {
                    let mut chunk = [0; 4096];
                    match stream.read(&mut chunk).await {
                        Ok(0) | Err(_) => return,
                        Ok(read) => body.extend_from_slice(&chunk[..read]),
                    }
                }
                let _ = sender.send((ReceivedRequest { line, headers, body }, Connection(stream))).await;
            });
        }
    });
    (address, receiver)
}

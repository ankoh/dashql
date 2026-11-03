//! Runs a local Trino server (single node, tpch catalog) for manual checks of the app, e.g. of the query
//! progress of long `tpch.sf10` queries.
//!
//! `bazel run //:trino [-- --port 8080]` starts the server and stops it when Enter is pressed (or the input
//! ends). The first run downloads Trino and a Java runtime.
//!
//! Trino sends no CORS headers, so the web app could not reach it. The server therefore listens behind a small
//! proxy on the port: the proxy answers the CORS preflights, adds the CORS headers to the responses and drops
//! the `Authorization` header (Trino rejects passwords over HTTP). Trino builds the `nextUri` of its responses
//! from the forwarded host, so the app keeps talking to the proxy.

use std::io::BufRead;
use std::net::SocketAddr;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use trino_testing::TrinoServer;

/// The maximum size of a request head
const MAX_HEAD_BYTES: usize = 64 * 1024;

/// A parsed HTTP request
struct Request {
    method: String,
    target: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl Request {
    /// A header value by name
    fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(n, _)| n.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }
}

/// Read a request from a connection, None if the connection closed
async fn read_request(stream: &mut TcpStream) -> std::io::Result<Option<Request>> {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 8192];
    let head_end = loop {
        if let Some(end) = buffer.windows(4).position(|w| w == b"\r\n\r\n") {
            break end;
        }
        if buffer.len() > MAX_HEAD_BYTES {
            return Err(std::io::Error::other("request head too large"));
        }
        let n = stream.read(&mut chunk).await?;
        if n == 0 {
            return Ok(None);
        }
        buffer.extend_from_slice(&chunk[..n]);
    };
    let head = String::from_utf8_lossy(&buffer[..head_end]).to_string();
    let mut lines = head.split("\r\n");
    let mut request_line = lines.next().unwrap_or_default().split(' ');
    let method = request_line.next().unwrap_or_default().to_string();
    let target = request_line.next().unwrap_or("/").to_string();
    let headers: Vec<(String, String)> = lines
        .filter_map(|line| line.split_once(':'))
        .map(|(name, value)| (name.trim().to_string(), value.trim().to_string()))
        .collect();
    let length = headers
        .iter()
        .find(|(n, _)| n.eq_ignore_ascii_case("content-length"))
        .and_then(|(_, v)| v.parse::<usize>().ok())
        .unwrap_or(0);
    let mut body = buffer[head_end + 4..].to_vec();
    while body.len() < length {
        let n = stream.read(&mut chunk).await?;
        if n == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..n]);
    }
    body.truncate(length);
    Ok(Some(Request { method, target, headers, body }))
}

/// The CORS headers of a response to a request
fn cors_headers(request: &Request) -> String {
    let origin = request.header("origin").unwrap_or("*");
    let allowed = request.header("access-control-request-headers").unwrap_or("*");
    format!(
        "Access-Control-Allow-Origin: {origin}\r\n\
         Access-Control-Allow-Methods: GET, POST, PUT, DELETE, HEAD, OPTIONS\r\n\
         Access-Control-Allow-Headers: {allowed}\r\n\
         Access-Control-Expose-Headers: *\r\n\
         Access-Control-Max-Age: 600\r\n\
         Vary: Origin\r\n"
    )
}

/// Forward a request to Trino and write the response with CORS headers
async fn handle(mut stream: TcpStream, client: reqwest::Client, trino: SocketAddr) -> std::io::Result<()> {
    let Some(request) = read_request(&mut stream).await? else { return Ok(()) };
    if request.method.eq_ignore_ascii_case("OPTIONS") {
        let cors = cors_headers(&request);
        let response = format!("HTTP/1.1 204 No Content\r\n{cors}Content-Length: 0\r\nConnection: close\r\n\r\n");
        return stream.write_all(response.as_bytes()).await;
    }
    let method = reqwest::Method::from_bytes(request.method.as_bytes()).map_err(std::io::Error::other)?;
    let mut forwarded = client.request(method, format!("http://{trino}{}", request.target));
    for (name, value) in &request.headers {
        let skipped = ["host", "connection", "content-length", "authorization", "origin", "referer"];
        if !skipped.iter().any(|s| name.eq_ignore_ascii_case(s)) {
            forwarded = forwarded.header(name, value);
        }
    }
    // Trino builds the URIs of its responses from the forwarded host
    if let Some(host) = request.header("host") {
        forwarded = forwarded.header("X-Forwarded-Host", host).header("X-Forwarded-Proto", "http");
    }
    let (status, headers, body) = match forwarded.body(request.body.clone()).send().await {
        Ok(response) => {
            let status = response.status();
            let headers = response.headers().clone();
            let body = response.bytes().await.map_err(std::io::Error::other)?;
            (status, headers, body.to_vec())
        }
        Err(e) => (reqwest::StatusCode::BAD_GATEWAY, Default::default(), e.to_string().into_bytes()),
    };
    let mut head = format!("HTTP/1.1 {} {}\r\n", status.as_u16(), status.canonical_reason().unwrap_or(""));
    for (name, value) in &headers {
        let skipped = ["connection", "content-length", "transfer-encoding", "keep-alive"];
        let name_str = name.as_str();
        if skipped.iter().any(|s| name_str.eq_ignore_ascii_case(s)) || name_str.starts_with("access-control-") {
            continue;
        }
        head.push_str(&format!("{}: {}\r\n", name, value.to_str().unwrap_or_default()));
    }
    head.push_str(&cors_headers(&request));
    head.push_str(&format!("Content-Length: {}\r\nConnection: close\r\n\r\n", body.len()));
    stream.write_all(head.as_bytes()).await?;
    stream.write_all(&body).await
}

/// Serve the proxy until the process ends
async fn serve(listener: TcpListener, trino: SocketAddr) {
    let client = reqwest::Client::new();
    loop {
        let Ok((stream, _)) = listener.accept().await else { continue };
        let client = client.clone();
        tokio::spawn(async move {
            if let Err(e) = handle(stream, client, trino).await {
                eprintln!("proxy: {e}");
            }
        });
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let port = args
        .iter()
        .position(|arg| arg == "--port")
        .and_then(|i| args.get(i + 1))
        .map(|port| port.parse::<u16>().unwrap_or_else(|_| panic!("invalid port {port}")))
        .unwrap_or(8080);

    let runtime = tokio::runtime::Builder::new_multi_thread().enable_all().build().expect("tokio runtime");
    let listener = runtime
        .block_on(TcpListener::bind(("127.0.0.1", port)))
        .unwrap_or_else(|e| panic!("cannot listen on port {port}: {e}"));

    println!("Starting Trino (the first run downloads Trino and a Java runtime)...");
    let server = TrinoServer::start().unwrap_or_else(|e| panic!("cannot start Trino: {e}"));
    let trino: SocketAddr = server.endpoint.trim_start_matches("http://").parse().expect("Trino address");
    runtime.spawn(serve(listener, trino));

    println!();
    println!("Trino serves at http://127.0.0.1:{port}");
    println!();
    println!("  Connect the app:  endpoint http://127.0.0.1:{port}, basic auth, any user name, no password");
    println!("  Catalog:          tpch (schemas tiny, sf1, sf10, sf100, ...)");
    println!(
        "  A long query:     select l_returnflag, count(*), sum(l_extendedprice) from tpch.sf10.lineitem group by 1"
    );
    println!("  Server log:       {}", server.log_path.display());
    println!();
    println!("Press Enter to stop.");
    let _ = std::io::stdin().lock().lines().next();
    drop(server);
}

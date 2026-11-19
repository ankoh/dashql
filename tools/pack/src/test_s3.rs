//! An S3 server in memory for the tests of the commands that talk to the release bucket, and the files they read.

use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use crate::remote_access::RemoteAccess;

/// Held by the tests that read or change the R2 variables of the environment
pub static ENV_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// A request the server received
#[derive(Clone, Debug)]
pub struct Request {
    pub method: String,
    /// The object key, empty for requests to the bucket
    pub key: String,
    pub query: BTreeMap<String, String>,
    /// The headers with lowercase names
    pub headers: BTreeMap<String, String>,
    /// The body without its chunked encoding
    pub body: Vec<u8>,
}

#[derive(Default)]
struct State {
    objects: BTreeMap<String, Vec<u8>>,
    requests: Vec<Request>,
    /// Keys that uploads are refused for
    denied_uploads: HashSet<String>,
    /// Keys that a delete reports an error for and keeps
    kept_objects: HashSet<String>,
    deny_listing: bool,
    deny_deletes: bool,
    page_size: Option<usize>,
}

/// The server. It answers path-style requests to the bucket `dashql-get`, which is what the SDK sends to an IP address.
pub struct FakeS3 {
    endpoint: String,
    state: Arc<Mutex<State>>,
}

impl FakeS3 {
    pub async fn start() -> FakeS3 {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let state = Arc::new(Mutex::new(State::default()));
        let server_state = state.clone();
        tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                tokio::spawn(serve_connection(stream, server_state.clone()));
            }
        });
        FakeS3 { endpoint, state }
    }

    pub fn endpoint(&self) -> String {
        self.endpoint.clone()
    }

    pub fn client(&self) -> aws_sdk_s3::Client {
        RemoteAccess {
            r2_endpoint: self.endpoint.clone(),
            r2_access_key_id: "key".to_string(),
            r2_secret_access_key: "secret".to_string(),
        }.r2_client()
    }

    pub fn put_objects(&self, keys: Vec<String>) {
        let mut state = self.state.lock().unwrap();
        for key in keys {
            state.objects.insert(key, Vec::new());
        }
    }

    pub fn set_page_size(&self, size: usize) {
        self.state.lock().unwrap().page_size = Some(size);
    }

    pub fn deny_listing(&self) {
        self.state.lock().unwrap().deny_listing = true;
    }

    pub fn deny_deletes(&self) {
        self.state.lock().unwrap().deny_deletes = true;
    }

    pub fn deny_upload(&self, key: &str) {
        self.state.lock().unwrap().denied_uploads.insert(key.to_string());
    }

    pub fn keep_object(&self, key: &str) {
        self.state.lock().unwrap().kept_objects.insert(key.to_string());
    }

    /// The keys in the bucket, sorted
    pub fn object_keys(&self) -> Vec<String> {
        self.state.lock().unwrap().objects.keys().cloned().collect()
    }

    pub fn object(&self, key: &str) -> Option<Vec<u8>> {
        self.state.lock().unwrap().objects.get(key).cloned()
    }

    pub fn requests(&self) -> Vec<Request> {
        self.state.lock().unwrap().requests.clone()
    }
}

async fn serve_connection(mut stream: TcpStream, state: Arc<Mutex<State>>) {
    let mut buffer = Vec::new();
    loop {
        let header_end = loop {
            if let Some(position) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
                break position;
            }
            let mut chunk = [0; 8192];
            match stream.read(&mut chunk).await {
                Ok(0) | Err(_) => return,
                Ok(read) => buffer.extend_from_slice(&chunk[..read]),
            }
        };
        let head = String::from_utf8_lossy(&buffer[..header_end]).to_string();
        buffer.drain(..header_end + 4);

        let mut lines = head.split("\r\n");
        let mut request_line = lines.next().unwrap().split(' ');
        let method = request_line.next().unwrap().to_string();
        let target = request_line.next().unwrap().to_string();
        let headers: BTreeMap<String, String> = lines
            .filter_map(|line| line.split_once(':'))
            .map(|(name, value)| (name.trim().to_lowercase(), value.trim().to_string()))
            .collect();

        if headers.contains_key("expect") {
            let _ = stream.write_all(b"HTTP/1.1 100 Continue\r\n\r\n").await;
        }

        let raw = if headers.get("transfer-encoding").is_some_and(|value| value.contains("chunked")) {
            loop {
                if let Some(length) = chunked_length(&buffer) {
                    break buffer.drain(..length).collect::<Vec<u8>>();
                }
                let mut chunk = [0; 65536];
                match stream.read(&mut chunk).await {
                    Ok(0) | Err(_) => return,
                    Ok(read) => buffer.extend_from_slice(&chunk[..read]),
                }
            }
        } else {
            let length: usize = headers.get("content-length").map_or(0, |value| value.parse().unwrap());
            while buffer.len() < length {
                let mut chunk = [0; 65536];
                match stream.read(&mut chunk).await {
                    Ok(0) | Err(_) => return,
                    Ok(read) => buffer.extend_from_slice(&chunk[..read]),
                }
            }
            buffer.drain(..length).collect()
        };
        let body = if headers.get("content-encoding").is_some_and(|value| value.contains("aws-chunked"))
            || headers.get("transfer-encoding").is_some_and(|value| value.contains("chunked")) {
            decode_chunks(&raw)
        } else {
            raw
        };

        let (path, query) = target.split_once('?').unwrap_or((&target, ""));
        let query: BTreeMap<String, String> = query
            .split('&')
            .filter(|pair| !pair.is_empty())
            .map(|pair| {
                let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
                (percent_decode(name), percent_decode(value))
            })
            .collect();
        let relative = path.strip_prefix("/dashql-get").unwrap_or_else(|| panic!("request outside of the bucket: {path}"));
        let key = percent_decode(relative.strip_prefix('/').unwrap_or(relative));

        let request = Request { method, key, query, headers, body };
        let (status, response) = respond(&mut state.lock().unwrap(), &request);
        state.lock().unwrap().requests.push(request);
        let reply = format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/xml\r\nETag: \"etag\"\r\nContent-Length: {}\r\n\r\n{response}",
            response.len(),
        );
        if stream.write_all(reply.as_bytes()).await.is_err() {
            return;
        }
    }
}

const ACCESS_DENIED: (&str, &str) = (
    "403 Forbidden",
    r#"<?xml version="1.0"?><Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>"#,
);

fn respond(state: &mut State, request: &Request) -> (&'static str, String) {
    const OK: &str = "200 OK";
    match (request.method.as_str(), request.key.as_str()) {
        ("GET", "") => {
            if state.deny_listing {
                return (ACCESS_DENIED.0, ACCESS_DENIED.1.to_string());
            }
            let prefix = request.query.get("prefix").cloned().unwrap_or_default();
            let start: usize = request.query.get("continuation-token").map_or(0, |token| token.parse().unwrap());
            let matching: Vec<&String> = state.objects.keys().filter(|key| key.starts_with(&prefix)).collect();
            let end = state.page_size.map_or(matching.len(), |size| (start + size).min(matching.len()));
            let contents: String = matching[start..end].iter().map(|key| format!("<Contents><Key>{key}</Key></Contents>")).collect();
            let next = if end < matching.len() {
                format!("<IsTruncated>true</IsTruncated><NextContinuationToken>{end}</NextContinuationToken>")
            } else {
                "<IsTruncated>false</IsTruncated>".to_string()
            };
            (OK, format!(r#"<?xml version="1.0"?><ListBucketResult><Name>dashql-get</Name>{next}{contents}</ListBucketResult>"#))
        }
        ("POST", "") => {
            if state.deny_deletes {
                return (ACCESS_DENIED.0, ACCESS_DENIED.1.to_string());
            }
            let body = String::from_utf8_lossy(&request.body).to_string();
            let mut result = String::new();
            for part in body.split("<Key>").skip(1) {
                let key = part.split("</Key>").next().unwrap();
                if state.kept_objects.contains(key) {
                    result.push_str(&format!("<Error><Key>{key}</Key><Code>AccessDenied</Code><Message>denied</Message></Error>"));
                } else {
                    state.objects.remove(key);
                    result.push_str(&format!("<Deleted><Key>{key}</Key></Deleted>"));
                }
            }
            (OK, format!(r#"<?xml version="1.0"?><DeleteResult>{result}</DeleteResult>"#))
        }
        (method, key) if state.denied_uploads.contains(key) && (method == "PUT" || method == "POST") => {
            (ACCESS_DENIED.0, ACCESS_DENIED.1.to_string())
        }
        ("POST", key) if request.query.contains_key("uploads") => {
            (OK, format!(r#"<?xml version="1.0"?><InitiateMultipartUploadResult><Bucket>dashql-get</Bucket><Key>{key}</Key><UploadId>upload</UploadId></InitiateMultipartUploadResult>"#))
        }
        ("PUT", _) if request.query.contains_key("partNumber") => (OK, String::new()),
        ("POST", key) if request.query.contains_key("uploadId") => {
            let parts = state.requests.iter()
                .filter(|part| part.key == key && part.query.contains_key("partNumber"))
                .flat_map(|part| part.body.clone())
                .collect();
            state.objects.insert(key.to_string(), parts);
            (OK, format!(r#"<?xml version="1.0"?><CompleteMultipartUploadResult><Key>{key}</Key><ETag>"etag"</ETag></CompleteMultipartUploadResult>"#))
        }
        ("PUT", key) => {
            state.objects.insert(key.to_string(), request.body.clone());
            (OK, String::new())
        }
        _ => panic!("unexpected request: {} {}", request.method, request.key),
    }
}

/// The length of a complete chunked body at the begin of the buffer
fn chunked_length(buffer: &[u8]) -> Option<usize> {
    let mut position = 0;
    loop {
        let line_end = position + buffer[position..].windows(2).position(|window| window == b"\r\n")?;
        let line = std::str::from_utf8(&buffer[position..line_end]).ok()?;
        let size = usize::from_str_radix(line.split(';').next()?.trim(), 16).ok()?;
        position = line_end + 2;
        if size == 0 {
            // The trailers end with an empty line
            let end = position + buffer[position..].windows(2).position(|window| window == b"\r\n")?;
            if end == position {
                return Some(end + 2);
            }
            let trailers_end = position + buffer[position..].windows(4).position(|window| window == b"\r\n\r\n")?;
            return Some(trailers_end + 4);
        }
        if buffer.len() < position + size + 2 {
            return None;
        }
        position += size + 2;
    }
}

/// Remove the chunk framing of a body
fn decode_chunks(raw: &[u8]) -> Vec<u8> {
    let mut decoded = Vec::new();
    let mut position = 0;
    while let Some(offset) = raw[position..].windows(2).position(|window| window == b"\r\n") {
        let line = String::from_utf8_lossy(&raw[position..position + offset]).to_string();
        let Ok(size) = usize::from_str_radix(line.split(';').next().unwrap().trim(), 16) else { break };
        position += offset + 2;
        if size == 0 {
            break;
        }
        decoded.extend_from_slice(&raw[position..position + size]);
        position += size + 2;
    }
    decoded
}

fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(value) = u8::from_str_radix(&text[i + 1..i + 3], 16) {
                decoded.push(value);
                i += 3;
                continue;
            }
        }
        decoded.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(decoded).unwrap()
}

/// A directory that is removed at the end of a test
pub struct TempDir(PathBuf);

impl TempDir {
    pub fn new() -> TempDir {
        let path = std::env::temp_dir().join(format!("dashql-pack-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        TempDir(path)
    }

    pub fn path(&self) -> &Path {
        &self.0
    }

    pub fn write(&self, name: &str, content: &[u8]) -> PathBuf {
        let path = self.0.join(name);
        std::fs::write(&path, content).unwrap();
        path
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Create a repository with a tagged commit and a number of commits after it
pub fn git_repository(path: &Path, tag: &str, commits_after_tag: usize) -> git2::Repository {
    let repo = git2::Repository::init(path).unwrap();
    let signature = git2::Signature::now("test", "test@example.com").unwrap();
    let commit = |parent: Option<git2::Oid>| {
        let tree_id = repo.treebuilder(None).unwrap().write().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let parents: Vec<git2::Commit> = parent.iter().map(|id| repo.find_commit(*id).unwrap()).collect();
        let parents: Vec<&git2::Commit> = parents.iter().collect();
        repo.commit(Some("HEAD"), &signature, &signature, "commit", &tree, &parents).unwrap()
    };
    let mut head = commit(None);
    repo.tag_lightweight(tag, &repo.find_object(head, None).unwrap(), false).unwrap();
    for _ in 0..commits_after_tag {
        head = commit(Some(head));
    }
    repo
}

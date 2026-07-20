use bytes::Bytes;
use http::header::{HOST, CONTENT_TYPE};
use http_body_util::{BodyExt, Full};
use hyper::client::conn::http1;
use hyper::{Request, StatusCode};
use hyper_util::rt::TokioIo;
use serde::Deserialize;
use std::sync::Arc;
use tokio::net::UnixStream;

use crate::docker_log_stream_manager::DockerLogStreamManager;
use crate::status::Status;

const DOCKER_SOCKET_PATH: &str = "/var/run/docker.sock";

/// Tiny wrapper around the Docker daemon Unix socket.
/// One connection per request for unary ops; streams use the manager.
pub struct DockerProxy {
    pub log_streams: Arc<DockerLogStreamManager>,
}

impl Default for DockerProxy {
    fn default() -> Self {
        Self {
            log_streams: Arc::new(DockerLogStreamManager::default()),
        }
    }
}

#[derive(Debug, Deserialize, serde::Serialize)]
pub struct ContainerPort {
    #[serde(rename = "PrivatePort")]
    pub private_port: u16,
    #[serde(rename = "PublicPort", default)]
    pub public_port: Option<u16>,
    #[serde(rename = "Type")]
    pub r#type: String,
    #[serde(rename = "IP", default)]
    pub ip: Option<String>,
}

#[derive(Debug, Deserialize, serde::Serialize)]
pub struct ContainerSummary {
    #[serde(rename = "Id")]
    pub id: String,
    #[serde(rename = "Names")]
    pub names: Vec<String>,
    #[serde(rename = "Image")]
    pub image: String,
    #[serde(rename = "State")]
    pub state: String,
    #[serde(rename = "Status")]
    pub status: String,
    #[serde(rename = "Labels", default)]
    pub labels: std::collections::HashMap<String, String>,
    #[serde(rename = "Ports", default)]
    pub ports: Vec<ContainerPort>,
}

impl DockerProxy {
    /// Run a unary HTTP/1 request against the Docker Unix socket.
    /// Returns (status_code, body_bytes).
    async fn request_unix(
        &self,
        method: &str,
        path: &str,
        body: Vec<u8>,
        content_type: Option<&str>,
    ) -> Result<(StatusCode, Vec<u8>), Status> {
        let stream = UnixStream::connect(DOCKER_SOCKET_PATH)
            .await
            .map_err(|e| Status::DockerSocketConnectFailed { message: e.to_string() })?;
        let io = TokioIo::new(stream);
        let (mut sender, conn) = http1::handshake(io)
            .await
            .map_err(|e| Status::DockerRequestFailed { error: format!("handshake failed: {}", e) })?;
        // Drive the connection in the background.
        tokio::spawn(async move {
            if let Err(e) = conn.await {
                log::debug!("Docker connection closed: {}", e);
            }
        });

        let mut req_builder = Request::builder()
            .method(method)
            .uri(path)
            .header(HOST, "docker");
        if let Some(ct) = content_type {
            req_builder = req_builder.header(CONTENT_TYPE, ct);
        }
        let request = req_builder
            .body(Full::new(Bytes::from(body)))
            .map_err(|e| Status::DockerRequestFailed { error: e.to_string() })?;

        let response = sender
            .send_request(request)
            .await
            .map_err(|e| Status::DockerRequestFailed { error: e.to_string() })?;
        let status = response.status();
        let body_bytes = response
            .into_body()
            .collect()
            .await
            .map_err(|e| Status::DockerRequestFailed { error: e.to_string() })?
            .to_bytes()
            .to_vec();
        Ok((status, body_bytes))
    }

    /// List containers, optionally filtered by a label key (value-agnostic).
    pub async fn list_containers(&self, label: Option<&str>) -> Result<Vec<ContainerSummary>, Status> {
        let path = if let Some(label) = label {
            // Docker filters: {"label":["dashql"]}
            let filters = serde_json::json!({ "label": [label] }).to_string();
            let encoded = url::form_urlencoded::byte_serialize(filters.as_bytes()).collect::<String>();
            format!("/containers/json?all=true&filters={}", encoded)
        } else {
            "/containers/json?all=true".to_string()
        };
        let (status, body) = self.request_unix("GET", &path, Vec::new(), None).await?;
        if !status.is_success() {
            return Err(Status::DockerRequestFailed {
                error: format!("status={} body={}", status, String::from_utf8_lossy(&body)),
            });
        }
        let parsed: Vec<ContainerSummary> = serde_json::from_slice(&body)
            .map_err(|e| Status::DockerRequestFailed { error: format!("decode containers: {}", e) })?;
        Ok(parsed)
    }

    /// Start a container by id.
    pub async fn start_container(&self, id: &str) -> Result<(), Status> {
        let path = format!("/containers/{}/start", id);
        let (status, body) = self.request_unix("POST", &path, Vec::new(), None).await?;
        // 204 = success, 304 = already started
        if status == StatusCode::NO_CONTENT || status == StatusCode::NOT_MODIFIED {
            Ok(())
        } else {
            Err(Status::DockerRequestFailed {
                error: format!("start container status={} body={}", status, String::from_utf8_lossy(&body)),
            })
        }
    }

    /// Stop a container by id.
    pub async fn stop_container(&self, id: &str) -> Result<(), Status> {
        let path = format!("/containers/{}/stop", id);
        let (status, body) = self.request_unix("POST", &path, Vec::new(), None).await?;
        if status == StatusCode::NO_CONTENT || status == StatusCode::NOT_MODIFIED {
            Ok(())
        } else {
            Err(Status::DockerRequestFailed {
                error: format!("stop container status={} body={}", status, String::from_utf8_lossy(&body)),
            })
        }
    }

    /// Remove a container by id (force=true to also kill running ones).
    pub async fn remove_container(&self, id: &str, force: bool) -> Result<(), Status> {
        let path = format!("/containers/{}?force={}", id, if force { "true" } else { "false" });
        let (status, body) = self.request_unix("DELETE", &path, Vec::new(), None).await?;
        if status == StatusCode::NO_CONTENT {
            Ok(())
        } else {
            Err(Status::DockerRequestFailed {
                error: format!("remove container status={} body={}", status, String::from_utf8_lossy(&body)),
            })
        }
    }

    /// Create a container. body_json is the raw Docker create-spec JSON.
    /// Returns the new container id.
    pub async fn create_container(&self, name: Option<&str>, body_json: Vec<u8>) -> Result<String, Status> {
        let path = if let Some(name) = name {
            format!("/containers/create?name={}", urlencoding(name))
        } else {
            "/containers/create".to_string()
        };
        // The Docker daemon does not expand "~" in bind mounts, so we expand a
        // leading tilde in each HostConfig.Binds host path to the user's home.
        let body_json = expand_bind_tildes(body_json)?;
        let (status, body) = self
            .request_unix("POST", &path, body_json, Some("application/json"))
            .await?;
        if !status.is_success() {
            return Err(Status::DockerRequestFailed {
                error: format!("create container status={} body={}", status, String::from_utf8_lossy(&body)),
            });
        }
        #[derive(Deserialize)]
        struct CreateResp {
            #[serde(rename = "Id")]
            id: String,
        }
        let parsed: CreateResp = serde_json::from_slice(&body)
            .map_err(|e| Status::DockerRequestFailed { error: format!("decode create: {}", e) })?;
        Ok(parsed.id)
    }
}

/// Tiny percent-encoder for path segments / query values.
fn urlencoding(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

/// The current user's home directory, or None if it cannot be determined.
fn home_dir() -> Option<String> {
    std::env::var("HOME")
        .ok()
        .or_else(|| std::env::var("USERPROFILE").ok())
        .filter(|h| !h.is_empty())
}

/// Expand a leading "~" (as "~", "~/", or "~\") in a bind mount's host path to
/// `home`. The host path is the substring before the first ':' (the
/// container-path / options separator). Everything else is left untouched.
fn expand_bind_tilde(bind: &str, home: &str) -> String {
    let (host, rest) = match bind.find(':') {
        Some(idx) => (&bind[..idx], &bind[idx..]),
        None => (bind, ""),
    };
    let expanded = if host == "~" {
        home.to_string()
    } else if let Some(tail) = host.strip_prefix("~/").or_else(|| host.strip_prefix("~\\")) {
        format!("{}/{}", home.trim_end_matches('/'), tail)
    } else {
        return bind.to_string();
    };
    format!("{}{}", expanded, rest)
}

/// Expand leading tildes in every HostConfig.Binds host path of a Docker
/// create-container spec. Returns the (possibly rewritten) JSON body. If the
/// body has no Binds, or the home directory is unknown, the body is returned
/// unchanged.
fn expand_bind_tildes(body_json: Vec<u8>) -> Result<Vec<u8>, Status> {
    // Only rewrite when there is actually a tilde to expand.
    if !body_json.contains(&b'~') {
        return Ok(body_json);
    }
    let home = match home_dir() {
        Some(home) => home,
        None => return Ok(body_json),
    };
    let mut spec: serde_json::Value = serde_json::from_slice(&body_json)
        .map_err(|e| Status::DockerRequestFailed { error: format!("decode create spec: {}", e) })?;
    if let Some(binds) = spec
        .get_mut("HostConfig")
        .and_then(|hc| hc.get_mut("Binds"))
        .and_then(|b| b.as_array_mut())
    {
        for bind in binds.iter_mut() {
            if let Some(s) = bind.as_str() {
                *bind = serde_json::Value::String(expand_bind_tilde(s, &home));
            }
        }
    }
    serde_json::to_vec(&spec)
        .map_err(|e| Status::DockerRequestFailed { error: format!("encode create spec: {}", e) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expand_tilde_only() {
        assert_eq!(expand_bind_tilde("~:/home/local/", "/Users/me"), "/Users/me:/home/local/");
    }

    #[test]
    fn expand_tilde_with_subpath() {
        assert_eq!(expand_bind_tilde("~/data:/home/local/", "/Users/me"), "/Users/me/data:/home/local/");
    }

    #[test]
    fn expand_trims_trailing_home_slash() {
        assert_eq!(expand_bind_tilde("~/data:/mnt", "/Users/me/"), "/Users/me/data:/mnt");
    }

    #[test]
    fn no_tilde_is_untouched() {
        assert_eq!(expand_bind_tilde("/abs/path:/mnt", "/Users/me"), "/abs/path:/mnt");
    }

    #[test]
    fn tilde_only_in_container_path_is_untouched() {
        // Only the host path (before the first ':') is expanded.
        assert_eq!(expand_bind_tilde("/abs:~/nope", "/Users/me"), "/abs:~/nope");
    }

    #[test]
    fn expand_bind_tildes_rewrites_binds() {
        std::env::set_var("HOME", "/Users/me");
        let body = br#"{"Image":"x","HostConfig":{"Binds":["~:/home/local/","/abs:/mnt"]}}"#.to_vec();
        let out = expand_bind_tildes(body).unwrap();
        let v: serde_json::Value = serde_json::from_slice(&out).unwrap();
        let binds = v["HostConfig"]["Binds"].as_array().unwrap();
        assert_eq!(binds[0], "/Users/me:/home/local/");
        assert_eq!(binds[1], "/abs:/mnt");
    }

    #[test]
    fn expand_bind_tildes_without_binds_is_noop() {
        let body = br#"{"Image":"x"}"#.to_vec();
        let out = expand_bind_tildes(body.clone()).unwrap();
        assert_eq!(out, body);
    }
}

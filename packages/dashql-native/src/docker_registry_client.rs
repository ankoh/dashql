use std::time::Duration;

use crate::status::Status;

/// Resolve a docker repository string into (registry_host, repository_path).
///
/// Heuristic mirrors the docker CLI:
/// - "alpine"            → ("registry-1.docker.io", "library/alpine")
/// - "ankoh/hyperdb"     → ("registry-1.docker.io", "ankoh/hyperdb")
/// - "host.example/x/y"  → ("host.example", "x/y")  (when first segment looks like a hostname)
pub fn resolve_registry(repo: &str) -> (String, String) {
    let trimmed = repo.trim();
    let first_slash = trimmed.find('/');
    match first_slash {
        None => (
            "registry-1.docker.io".to_string(),
            format!("library/{}", trimmed),
        ),
        Some(idx) => {
            let head = &trimmed[..idx];
            let rest = &trimmed[idx + 1..];
            // First segment is a hostname iff it contains '.' or ':' or equals "localhost".
            if head == "localhost" || head.contains('.') || head.contains(':') {
                (head.to_string(), rest.to_string())
            } else {
                ("registry-1.docker.io".to_string(), trimmed.to_string())
            }
        }
    }
}

/// Parse a `WWW-Authenticate: Bearer realm="...",service="...",scope="..."` header.
fn parse_bearer_challenge(value: &str) -> Option<(String, Option<String>, Option<String>)> {
    let value = value.trim();
    if !value.to_lowercase().starts_with("bearer ") {
        return None;
    }
    let body = &value[7..];
    let mut realm = None;
    let mut service = None;
    let mut scope = None;
    for part in body.split(',') {
        let mut kv = part.trim().splitn(2, '=');
        let key = kv.next()?.trim();
        let val_raw = kv.next()?.trim();
        let val = val_raw.trim_matches('"').to_string();
        match key {
            "realm" => realm = Some(val),
            "service" => service = Some(val),
            "scope" => scope = Some(val),
            _ => {}
        }
    }
    realm.map(|r| (r, service, scope))
}

async fn build_client() -> Result<reqwest::Client, Status> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| Status::DockerRegistryFailed { message: format!("client build: {}", e) })
}

/// Fetch all tags for a repository, following the OCI distribution `Link: rel="next"` pagination.
/// Performs an anonymous bearer token exchange when the registry challenges.
pub async fn list_tags(repository: &str) -> Result<Vec<String>, Status> {
    let (registry, repo_path) = resolve_registry(repository);
    let client = build_client().await?;

    // Probe /v2/ to learn whether auth is needed.
    let probe_url = format!("https://{}/v2/", registry);
    let probe = client
        .get(&probe_url)
        .send()
        .await
        .map_err(|e| Status::DockerRegistryFailed { message: format!("probe failed: {}", e) })?;

    let mut bearer: Option<String> = None;
    if probe.status() == reqwest::StatusCode::UNAUTHORIZED {
        let www_auth = probe
            .headers()
            .get(reqwest::header::WWW_AUTHENTICATE)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string())
            .unwrap_or_default();
        if let Some((realm, service, _scope)) = parse_bearer_challenge(&www_auth) {
            // Request an anonymous token scoped to this repo.
            let mut token_url = url::Url::parse(&realm)
                .map_err(|e| Status::DockerRegistryFailed { message: format!("realm url: {}", e) })?;
            {
                let mut q = token_url.query_pairs_mut();
                if let Some(svc) = service.as_ref() {
                    q.append_pair("service", svc);
                }
                q.append_pair("scope", &format!("repository:{}:pull", repo_path));
            }
            let token_resp = client
                .get(token_url)
                .send()
                .await
                .map_err(|e| Status::DockerRegistryFailed { message: format!("token: {}", e) })?;
            if !token_resp.status().is_success() {
                return Err(Status::DockerRegistryFailed {
                    message: format!("token endpoint status {}", token_resp.status()),
                });
            }
            #[derive(serde::Deserialize)]
            struct TokenResp {
                #[serde(default)]
                token: Option<String>,
                #[serde(default, rename = "access_token")]
                access_token: Option<String>,
            }
            let parsed: TokenResp = token_resp
                .json()
                .await
                .map_err(|e| Status::DockerRegistryFailed { message: format!("token decode: {}", e) })?;
            bearer = parsed.token.or(parsed.access_token);
        }
    }

    // Walk pages.
    let mut all_tags: Vec<String> = Vec::new();
    let mut next_url = format!("https://{}/v2/{}/tags/list?n=100", registry, repo_path);
    loop {
        let mut req = client.get(&next_url);
        if let Some(token) = bearer.as_ref() {
            req = req.bearer_auth(token);
        }
        let resp = req
            .send()
            .await
            .map_err(|e| Status::DockerRegistryFailed { message: format!("tags request: {}", e) })?;
        if !resp.status().is_success() {
            return Err(Status::DockerRegistryFailed {
                message: format!("tags status {}", resp.status()),
            });
        }
        // Record next link before consuming the body.
        let link_next = resp
            .headers()
            .get(reqwest::header::LINK)
            .and_then(|v| v.to_str().ok())
            .and_then(parse_link_next)
            .map(|p| absolutize_link(&registry, &p));

        #[derive(serde::Deserialize)]
        struct TagsResp {
            #[serde(default)]
            tags: Option<Vec<String>>,
        }
        let parsed: TagsResp = resp
            .json()
            .await
            .map_err(|e| Status::DockerRegistryFailed { message: format!("tags decode: {}", e) })?;
        if let Some(tags) = parsed.tags {
            all_tags.extend(tags);
        }
        match link_next {
            Some(next) => next_url = next,
            None => break,
        }
    }
    Ok(all_tags)
}

/// Parse an RFC5988 Link header looking for the `rel="next"` URL, returning the URL part.
fn parse_link_next(link: &str) -> Option<String> {
    for entry in link.split(',') {
        let entry = entry.trim();
        // Format: <url>; rel="next"
        let mut parts = entry.splitn(2, ';');
        let url_part = parts.next()?.trim();
        let rel_part = parts.next()?.trim();
        if !url_part.starts_with('<') || !url_part.ends_with('>') {
            continue;
        }
        let url = &url_part[1..url_part.len() - 1];
        if rel_part.contains("rel=\"next\"") || rel_part.contains("rel=next") {
            return Some(url.to_string());
        }
    }
    None
}

fn absolutize_link(registry: &str, link: &str) -> String {
    if link.starts_with("http://") || link.starts_with("https://") {
        link.to_string()
    } else if link.starts_with('/') {
        format!("https://{}{}", registry, link)
    } else {
        format!("https://{}/{}", registry, link)
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn test_resolve_dockerhub_library() {
        let (host, repo) = resolve_registry("alpine");
        assert_eq!(host, "registry-1.docker.io");
        assert_eq!(repo, "library/alpine");
    }

    #[test]
    fn test_resolve_dockerhub_user() {
        let (host, repo) = resolve_registry("ankoh/hyperdb");
        assert_eq!(host, "registry-1.docker.io");
        assert_eq!(repo, "ankoh/hyperdb");
    }

    #[test]
    fn test_resolve_custom_registry() {
        let (host, repo) = resolve_registry("docker.repo.local.sfdc.net/sfci/gec/hyper-db-emu/hyper-db/hyperd");
        assert_eq!(host, "docker.repo.local.sfdc.net");
        assert_eq!(repo, "sfci/gec/hyper-db-emu/hyper-db/hyperd");
    }

    #[test]
    fn test_parse_bearer_challenge() {
        let challenge = r#"Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:library/alpine:pull""#;
        let (realm, service, scope) = parse_bearer_challenge(challenge).unwrap();
        assert_eq!(realm, "https://auth.docker.io/token");
        assert_eq!(service.as_deref(), Some("registry.docker.io"));
        assert_eq!(scope.as_deref(), Some("repository:library/alpine:pull"));
    }

    #[test]
    fn test_link_next() {
        let link = r#"</v2/foo/tags/list?n=100&last=v1.2.3>; rel="next""#;
        assert_eq!(parse_link_next(link).as_deref(), Some("/v2/foo/tags/list?n=100&last=v1.2.3"));
    }
}

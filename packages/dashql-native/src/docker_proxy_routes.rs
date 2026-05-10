use lazy_static::lazy_static;
use regex_automata::util::captures::Captures;
use regex_automata::meta::Regex;

#[derive(Debug, PartialEq)]
pub enum DockerProxyRoute {
    Containers,
    Container { id: String },
    ContainerStart { id: String },
    ContainerStop { id: String },
    ImagesPull,
    LogStreams,
    LogStream { stream_id: usize },
    RegistryTags,
}

lazy_static! {
    static ref ROUTES: Regex = Regex::new_many(&[
        r"^/docker/containers$",
        r"^/docker/containers/([A-Za-z0-9_\.-]+)$",
        r"^/docker/containers/([A-Za-z0-9_\.-]+)/start$",
        r"^/docker/containers/([A-Za-z0-9_\.-]+)/stop$",
        r"^/docker/images/pull$",
        r"^/docker/log-streams$",
        r"^/docker/log-streams/(\d+)$",
        r"^/docker/registry/tags$",
    ]).unwrap();
}

pub fn parse_docker_proxy_path(path: &str) -> Option<DockerProxyRoute> {
    let mut all = Captures::all(ROUTES.group_info().clone());
    ROUTES.captures(path, &mut all);
    match all.pattern().map(|p| p.as_usize()) {
        Some(0) => Some(DockerProxyRoute::Containers),
        Some(1) => {
            let id = path[all.get_group(1).unwrap()].to_string();
            Some(DockerProxyRoute::Container { id })
        }
        Some(2) => {
            let id = path[all.get_group(1).unwrap()].to_string();
            Some(DockerProxyRoute::ContainerStart { id })
        }
        Some(3) => {
            let id = path[all.get_group(1).unwrap()].to_string();
            Some(DockerProxyRoute::ContainerStop { id })
        }
        Some(4) => Some(DockerProxyRoute::ImagesPull),
        Some(5) => Some(DockerProxyRoute::LogStreams),
        Some(6) => {
            let stream_id = path[all.get_group(1).unwrap()].parse().unwrap_or_default();
            Some(DockerProxyRoute::LogStream { stream_id })
        }
        Some(7) => Some(DockerProxyRoute::RegistryTags),
        _ => None,
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use anyhow::Result;

    #[tokio::test]
    async fn test_valid_routes() -> Result<()> {
        assert_eq!(parse_docker_proxy_path("/docker/containers"), Some(DockerProxyRoute::Containers));
        assert_eq!(
            parse_docker_proxy_path("/docker/containers/abc123"),
            Some(DockerProxyRoute::Container { id: "abc123".to_string() })
        );
        assert_eq!(
            parse_docker_proxy_path("/docker/containers/abc123/start"),
            Some(DockerProxyRoute::ContainerStart { id: "abc123".to_string() })
        );
        assert_eq!(
            parse_docker_proxy_path("/docker/containers/abc123/stop"),
            Some(DockerProxyRoute::ContainerStop { id: "abc123".to_string() })
        );
        assert_eq!(parse_docker_proxy_path("/docker/images/pull"), Some(DockerProxyRoute::ImagesPull));
        assert_eq!(parse_docker_proxy_path("/docker/log-streams"), Some(DockerProxyRoute::LogStreams));
        assert_eq!(
            parse_docker_proxy_path("/docker/log-streams/42"),
            Some(DockerProxyRoute::LogStream { stream_id: 42 })
        );
        assert_eq!(parse_docker_proxy_path("/docker/registry/tags"), Some(DockerProxyRoute::RegistryTags));
        Ok(())
    }

    #[tokio::test]
    async fn test_invalid_routes() -> Result<()> {
        assert_eq!(parse_docker_proxy_path("/docker/foo"), None);
        assert_eq!(parse_docker_proxy_path("/docker/containers/"), None);
        assert_eq!(parse_docker_proxy_path("/docker/log-streams/foo"), None);
        Ok(())
    }
}

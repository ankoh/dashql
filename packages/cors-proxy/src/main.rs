use std::net::SocketAddr;
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use bytes::Bytes;
use clap::Parser;
use http::header::{HeaderName, HeaderValue};
use http::uri::Scheme;
use http::{HeaderMap, Method, Request, Response, StatusCode, Uri};
use http_body_util::combinators::BoxBody;
use http_body_util::{BodyExt, Empty, Full};
use hyper::body::Incoming;
use hyper::service::service_fn;
use hyper_util::rt::TokioIo;
use tokio::net::TcpListener;

const HEADER_FORWARD_TO: &str = "x-forward-to";

#[derive(Parser, Debug)]
#[command(
    name = "cors-proxy",
    about = "CORS proxy that forwards requests with an X-Forward-To header to an allowlisted upstream and injects CORS headers."
)]
struct Args {
    /// Comma-separated list of host patterns allowed as forwarding targets
    /// (e.g. "*.salesforce.com,*.force.com"). "*" matches exactly one label.
    #[arg(long = "allow-forward-to", value_delimiter = ',', num_args = 1..)]
    allow_forward_to: Vec<String>,
    /// Local bind address (host:port), e.g. 127.0.0.1:8080.
    #[arg(long = "listen")]
    listen: String,
    /// Value for the Access-Control-Allow-Origin response header.
    #[arg(long = "allow-origin")]
    allow_origin: String,
}

#[derive(Debug, Clone)]
enum HostPattern {
    /// Exact host match, e.g. "login.salesforce.com".
    Exact(String),
    /// Suffix match: matches the suffix (including leading dot) or the bare suffix.
    /// Pattern "*.salesforce.com" matches "salesforce.com" is false; matches
    /// "login.salesforce.com", "a.b.salesforce.com", etc.
    Suffix(String),
}

impl HostPattern {
    fn parse(pattern: &str) -> Result<Self> {
        let trimmed = pattern.trim().to_ascii_lowercase();
        if trimmed.is_empty() {
            return Err(anyhow!("empty host pattern"));
        }
        if let Some(rest) = trimmed.strip_prefix("*.") {
            if rest.is_empty() || rest.contains('*') {
                return Err(anyhow!("invalid host pattern: {}", pattern));
            }
            return Ok(HostPattern::Suffix(rest.to_string()));
        }
        if trimmed.contains('*') {
            return Err(anyhow!(
                "invalid host pattern: {} (only leading *. wildcard is supported)",
                pattern
            ));
        }
        Ok(HostPattern::Exact(trimmed))
    }
    fn matches(&self, host: &str) -> bool {
        let host = host.to_ascii_lowercase();
        match self {
            HostPattern::Exact(h) => host == *h,
            HostPattern::Suffix(suf) => host.len() > suf.len() + 1 && host.ends_with(&format!(".{}", suf)),
        }
    }
    fn display(&self) -> String {
        match self {
            HostPattern::Exact(h) => h.clone(),
            HostPattern::Suffix(s) => format!("*.{}", s),
        }
    }
}

struct Config {
    allow_forward_to: Vec<HostPattern>,
    allow_origin: String,
    client: reqwest::Client,
}

type BoxedBody = BoxBody<Bytes, std::convert::Infallible>;

fn empty_body() -> BoxedBody {
    Empty::<Bytes>::new()
        .map_err(|never| match never {})
        .boxed()
}

fn full_body(bytes: Bytes) -> BoxedBody {
    Full::new(bytes).map_err(|never| match never {}).boxed()
}

fn is_hop_by_hop(name: &HeaderName) -> bool {
    matches!(
        name.as_str(),
        "connection"
            | "proxy-connection"
            | "keep-alive"
            | "transfer-encoding"
            | "te"
            | "trailer"
            | "upgrade"
            | "content-length"
    )
}

fn preflight_response(cfg: &Config, req_headers: &HeaderMap) -> Response<BoxedBody> {
    let requested = req_headers
        .get("access-control-request-headers")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("*")
        .to_string();

    let mut resp = Response::builder()
        .status(StatusCode::NO_CONTENT)
        .body(empty_body())
        .expect("preflight response");

    let h = resp.headers_mut();
    h.insert(
        "access-control-allow-origin",
        HeaderValue::from_str(&cfg.allow_origin).unwrap_or(HeaderValue::from_static("*")),
    );
    h.insert(
        "access-control-allow-methods",
        HeaderValue::from_static("GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS"),
    );
    h.insert(
        "access-control-allow-headers",
        HeaderValue::from_str(&requested).unwrap_or(HeaderValue::from_static("*")),
    );
    h.insert(
        "access-control-max-age",
        HeaderValue::from_static("86400"),
    );
    h.insert(
        "vary",
        HeaderValue::from_static("Origin, Access-Control-Request-Headers"),
    );
    resp
}

fn error_response(status: StatusCode, allow_origin: &str, msg: &str) -> Response<BoxedBody> {
    let mut resp = Response::builder()
        .status(status)
        .body(full_body(Bytes::from(msg.to_owned())))
        .expect("error response");
    resp.headers_mut().insert(
        "access-control-allow-origin",
        HeaderValue::from_str(allow_origin).unwrap_or(HeaderValue::from_static("*")),
    );
    resp.headers_mut()
        .insert("content-type", HeaderValue::from_static("text/plain"));
    resp
}

fn copy_request_headers(src: &HeaderMap, dst: &mut reqwest::header::HeaderMap) {
    for (name, value) in src.iter() {
        if is_hop_by_hop(name) {
            continue;
        }
        match name.as_str() {
            "host" | HEADER_FORWARD_TO => continue,
            _ => {}
        }
        if let (Ok(n), Ok(v)) = (
            reqwest::header::HeaderName::from_bytes(name.as_ref()),
            reqwest::header::HeaderValue::from_bytes(value.as_bytes()),
        ) {
            dst.append(n, v);
        }
    }
}

fn copy_response_headers(src: &reqwest::header::HeaderMap, dst: &mut HeaderMap) {
    for (name, value) in src.iter() {
        let name_str = name.as_str();
        if matches!(
            name_str,
            "connection"
                | "proxy-connection"
                | "keep-alive"
                | "transfer-encoding"
                | "te"
                | "trailer"
                | "upgrade"
                | "content-length"
                | "access-control-allow-origin"
                | "access-control-expose-headers"
                | "vary"
        ) {
            continue;
        }
        if let (Ok(n), Ok(v)) = (
            HeaderName::from_bytes(name_str.as_bytes()),
            HeaderValue::from_bytes(value.as_bytes()),
        ) {
            dst.append(n, v);
        }
    }
}

fn resolve_upstream(cfg: &Config, req: &Request<Incoming>) -> Result<String> {
    let forward_to = req
        .headers()
        .get(HEADER_FORWARD_TO)
        .ok_or_else(|| anyhow!("missing {} header", HEADER_FORWARD_TO))?
        .to_str()
        .map_err(|_| anyhow!("invalid {} header", HEADER_FORWARD_TO))?;
    let base: Uri = forward_to
        .parse()
        .with_context(|| format!("parse {}", HEADER_FORWARD_TO))?;
    if base.scheme() != Some(&Scheme::HTTPS) {
        return Err(anyhow!("{} must be https", HEADER_FORWARD_TO));
    }
    let host = base
        .host()
        .ok_or_else(|| anyhow!("{} missing host", HEADER_FORWARD_TO))?;
    if !cfg.allow_forward_to.iter().any(|p| p.matches(host)) {
        return Err(anyhow!("host {} not in --allow-forward-to", host));
    }
    let authority = base
        .authority()
        .ok_or_else(|| anyhow!("{} missing authority", HEADER_FORWARD_TO))?;
    let path_and_query = req
        .uri()
        .path_and_query()
        .map(|p| p.as_str())
        .unwrap_or("/");
    Ok(format!("https://{}{}", authority, path_and_query))
}

async fn handle(
    req: Request<Incoming>,
    cfg: Arc<Config>,
) -> Result<Response<BoxedBody>, std::convert::Infallible> {
    let method = req.method().clone();
    let path = req.uri().path().to_string();

    log::info!("{} {}", method, path);

    if method == Method::OPTIONS {
        return Ok(preflight_response(&cfg, req.headers()));
    }

    let upstream_url = match resolve_upstream(&cfg, &req) {
        Ok(u) => u,
        Err(e) => {
            log::warn!("reject {} {}: {:#}", method, path, e);
            return Ok(error_response(
                StatusCode::BAD_REQUEST,
                &cfg.allow_origin,
                &format!("bad forward target: {}", e),
            ));
        }
    };

    match forward(req, method, upstream_url.clone(), cfg.clone()).await {
        Ok(resp) => Ok(resp),
        Err(e) => {
            log::error!("forward to {} failed: {:#}", upstream_url, e);
            Ok(error_response(
                StatusCode::BAD_GATEWAY,
                &cfg.allow_origin,
                &format!("upstream error: {}", e),
            ))
        }
    }
}

async fn forward(
    req: Request<Incoming>,
    method: Method,
    upstream_url: String,
    cfg: Arc<Config>,
) -> Result<Response<BoxedBody>> {
    let (parts, body) = req.into_parts();
    let body_bytes = body
        .collect()
        .await
        .map_err(|e| anyhow!("read request body: {}", e))?
        .to_bytes();

    let mut fwd_headers = reqwest::header::HeaderMap::with_capacity(parts.headers.len());
    copy_request_headers(&parts.headers, &mut fwd_headers);

    let reqwest_method = reqwest::Method::from_bytes(method.as_str().as_bytes())
        .with_context(|| format!("invalid method: {}", method))?;

    let upstream = cfg
        .client
        .request(reqwest_method, &upstream_url)
        .headers(fwd_headers)
        .body(body_bytes)
        .send()
        .await
        .with_context(|| format!("send upstream request to {}", upstream_url))?;

    let status = upstream.status();
    let headers = upstream.headers().clone();
    let bytes = upstream
        .bytes()
        .await
        .with_context(|| format!("read upstream body from {}", upstream_url))?;

    log::info!("-> {} {}", status.as_u16(), upstream_url);

    let hyper_status = StatusCode::from_u16(status.as_u16())
        .with_context(|| format!("invalid upstream status: {}", status))?;

    let mut resp = Response::builder()
        .status(hyper_status)
        .body(full_body(bytes))
        .expect("upstream response");

    copy_response_headers(&headers, resp.headers_mut());

    let h = resp.headers_mut();
    h.insert(
        "access-control-allow-origin",
        HeaderValue::from_str(&cfg.allow_origin).unwrap_or(HeaderValue::from_static("*")),
    );
    h.insert(
        "access-control-expose-headers",
        HeaderValue::from_static("*"),
    );
    h.insert("vary", HeaderValue::from_static("Origin"));

    Ok(resp)
}

fn normalize(args: Args) -> Result<Config> {
    if args.allow_forward_to.is_empty() {
        return Err(anyhow!("--allow-forward-to must list at least one host pattern"));
    }
    let allow_forward_to = args
        .allow_forward_to
        .iter()
        .map(|p| HostPattern::parse(p))
        .collect::<Result<Vec<_>>>()?;

    Ok(Config {
        allow_forward_to,
        allow_origin: args.allow_origin,
        client: reqwest::Client::builder()
            .build()
            .expect("build reqwest client"),
    })
}

#[tokio::main]
async fn main() -> Result<()> {
    env_logger::Builder::from_default_env()
        .filter_level(log::LevelFilter::Info)
        .parse_default_env()
        .init();

    let args = Args::parse();
    let listen: SocketAddr = args
        .listen
        .parse()
        .with_context(|| format!("parse --listen: {}", args.listen))?;

    let cfg = Arc::new(normalize(args)?);
    let listener = TcpListener::bind(listen)
        .await
        .with_context(|| format!("bind {}", listen))?;

    log::info!(
        "cors-proxy listening on http://{}, allow-forward-to=[{}]",
        listen,
        cfg.allow_forward_to
            .iter()
            .map(|p| p.display())
            .collect::<Vec<_>>()
            .join(", ")
    );

    loop {
        let (stream, peer) = match listener.accept().await {
            Ok(v) => v,
            Err(e) => {
                log::error!("accept: {}", e);
                continue;
            }
        };
        let cfg = cfg.clone();
        tokio::spawn(async move {
            let io = TokioIo::new(stream);
            let service = service_fn(move |req| handle(req, cfg.clone()));
            if let Err(e) = hyper::server::conn::http1::Builder::new()
                .serve_connection(io, service)
                .await
            {
                log::debug!("conn {} ended: {}", peer, e);
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::HostPattern;

    #[test]
    fn exact_match() {
        let p = HostPattern::parse("login.salesforce.com").unwrap();
        assert!(p.matches("login.salesforce.com"));
        assert!(!p.matches("foo.salesforce.com"));
        assert!(!p.matches("salesforce.com"));
        assert!(!p.matches("login.salesforce.com.evil.example"));
    }

    #[test]
    fn suffix_wildcard() {
        let p = HostPattern::parse("*.salesforce.com").unwrap();
        assert!(p.matches("login.salesforce.com"));
        assert!(p.matches("orgfarm-abc.my.pc-rnd.salesforce.com"));
        assert!(!p.matches("salesforce.com"));
        assert!(!p.matches("evil.com"));
        assert!(!p.matches("notsalesforce.com"));
        assert!(!p.matches("login.salesforce.com.evil.example"));
    }

    #[test]
    fn case_insensitive() {
        let p = HostPattern::parse("*.Force.com").unwrap();
        assert!(p.matches("MyOrg.force.com"));
    }

    #[test]
    fn rejects_middle_wildcard() {
        assert!(HostPattern::parse("foo.*.com").is_err());
        assert!(HostPattern::parse("*").is_err());
        assert!(HostPattern::parse("*.").is_err());
    }
}

use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Result};
use clap::Parser;

use crate::grpc_client::ChannelCache;
use crate::query_registry::QueryRegistry;

#[derive(Parser, Debug)]
#[command(
    name = "hyper-http-proxy",
    about = "Salesforce Hyper Database HTTP v3 API proxy that forwards queries to the Hyper gRPC API."
)]
pub struct Args {
    /// Comma-separated list of host patterns allowed as Dashql-Grpc-Endpoint targets
    /// (e.g. "*.salesforce.com,*.force.com"). "*." matches any prefix.
    #[arg(long = "allow-forward-to", value_delimiter = ',', num_args = 1..)]
    pub allow_forward_to: Vec<String>,

    /// Local bind address (host:port), e.g. 127.0.0.1:9100.
    #[arg(long = "listen")]
    pub listen: String,

    /// Value for the Access-Control-Allow-Origin response header.
    #[arg(long = "allow-origin")]
    pub allow_origin: String,

    /// Time-to-live for buffered query state, in seconds.
    #[arg(long = "expiration-ttl-secs", default_value_t = 300)]
    pub expiration_ttl_secs: u64,

    /// Default long-poll timeout in milliseconds when clients omit waitTimeMs.
    #[arg(long = "long-poll-default-ms", default_value_t = 10_000)]
    pub long_poll_default_ms: u64,

    /// Maximum long-poll timeout in milliseconds.
    #[arg(long = "long-poll-max-ms", default_value_t = 60_000)]
    pub long_poll_max_ms: u64,

    /// Time to wait on POST /api/v3/query for a fast completion before returning
    /// a queryId for the client to poll. Set to 0 to always return a queryId.
    #[arg(long = "inline-deadline-ms", default_value_t = 1_500)]
    pub inline_deadline_ms: u64,
}

#[derive(Debug, Clone)]
pub enum HostPattern {
    /// Exact host match, e.g. "login.salesforce.com".
    Exact(String),
    /// Suffix match: "*.salesforce.com" matches "a.salesforce.com" but not
    /// "salesforce.com" and not "a.salesforce.com.evil.example".
    Suffix(String),
}

impl HostPattern {
    pub fn parse(pattern: &str) -> Result<Self> {
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

    pub fn matches(&self, host: &str) -> bool {
        let host = host.to_ascii_lowercase();
        match self {
            HostPattern::Exact(h) => host == *h,
            HostPattern::Suffix(suf) => {
                host.len() > suf.len() + 1 && host.ends_with(&format!(".{}", suf))
            }
        }
    }

    pub fn display(&self) -> String {
        match self {
            HostPattern::Exact(h) => h.clone(),
            HostPattern::Suffix(s) => format!("*.{}", s),
        }
    }
}

pub struct Config {
    pub allow_forward_to: Vec<HostPattern>,
    pub allow_origin: String,
    pub expiration_ttl: Duration,
    pub long_poll_default: Duration,
    pub long_poll_max: Duration,
    pub inline_deadline: Duration,
    pub registry: Arc<QueryRegistry>,
    pub channels: ChannelCache,
    /// Shared HTTP client used by the generic `Dashql-Forward-To` forwarder.
    pub http_client: reqwest::Client,
}

impl Config {
    pub fn from_args(args: Args) -> Result<Self> {
        if args.allow_forward_to.is_empty() {
            return Err(anyhow!(
                "--allow-forward-to must list at least one host pattern"
            ));
        }
        let allow_forward_to = args
            .allow_forward_to
            .iter()
            .map(|p| HostPattern::parse(p))
            .collect::<Result<Vec<_>>>()?;
        let http_client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| anyhow!("build reqwest client: {}", e))?;
        Ok(Config {
            allow_forward_to,
            allow_origin: args.allow_origin,
            expiration_ttl: Duration::from_secs(args.expiration_ttl_secs),
            long_poll_default: Duration::from_millis(args.long_poll_default_ms),
            long_poll_max: Duration::from_millis(args.long_poll_max_ms),
            inline_deadline: Duration::from_millis(args.inline_deadline_ms),
            registry: Arc::new(QueryRegistry::new()),
            channels: ChannelCache::new(),
            http_client,
        })
    }

    pub fn host_allowed(&self, host: &str) -> bool {
        self.allow_forward_to.iter().any(|p| p.matches(host))
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

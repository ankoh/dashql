use std::env;
use std::path::PathBuf;

use anyhow::Context;
use anyhow::Result;

pub struct GrpcTlsTestCerts {
    pub ca_cert_path: String,
    pub server_cert_path: String,
    pub server_key_path: String,
    pub client_cert_path: String,
    pub client_key_path: String,
    pub wrong_ca_cert_path: String,
    pub wrong_client_cert_path: String,
    pub wrong_client_key_path: String,
}

impl GrpcTlsTestCerts {
    pub fn generate() -> Result<Self> {
        let ca_cert_path = required_env("DASHQL_TEST_TLS_CA_CERT")?;
        let server_cert_path = required_env("DASHQL_TEST_TLS_SERVER_CERT")?;
        let server_key_path = required_env("DASHQL_TEST_TLS_SERVER_KEY")?;
        let client_cert_path = required_env("DASHQL_TEST_TLS_CLIENT_CERT")?;
        let client_key_path = required_env("DASHQL_TEST_TLS_CLIENT_KEY")?;
        let wrong_ca_cert_path = required_env("DASHQL_TEST_TLS_WRONG_CA_CERT")?;
        let wrong_client_cert_path = required_env("DASHQL_TEST_TLS_WRONG_CLIENT_CERT")?;
        let wrong_client_key_path = required_env("DASHQL_TEST_TLS_WRONG_CLIENT_KEY")?;

        Ok(Self {
            ca_cert_path,
            server_cert_path,
            server_key_path,
            client_cert_path,
            client_key_path,
            wrong_ca_cert_path,
            wrong_client_cert_path,
            wrong_client_key_path,
        })
    }
}

fn required_env(name: &str) -> Result<String> {
    let value = env::var(name).with_context(|| format!("missing required environment variable {name}"))?;
    let value = if let Some(suffix) = value.strip_prefix("${pwd}/") {
        let test_srcdir = env::var("TEST_SRCDIR").context("missing required environment variable TEST_SRCDIR")?;
        let execroot = test_srcdir
            .split_once("/bazel-out/")
            .map(|(prefix, _)| prefix)
            .context("failed to derive Bazel execroot from TEST_SRCDIR")?;
        PathBuf::from(execroot).join(suffix).to_string_lossy().into_owned()
    } else {
        value
    };
    let path = PathBuf::from(&value);
    if path.is_absolute() || path.exists() {
        if path.exists() {
            return Ok(value);
        }
    }

    let test_srcdir = env::var("TEST_SRCDIR").context("missing required environment variable TEST_SRCDIR")?;
    let test_srcdir = PathBuf::from(test_srcdir);
    let test_workspace = env::var("TEST_WORKSPACE").ok();
    let file_name = path
        .file_name()
        .context("environment variable did not contain a file name")?;
    let candidates = [
        test_srcdir.join(&value),
        test_workspace
            .as_ref()
            .map(|workspace| test_srcdir.join(workspace).join(&value))
            .unwrap_or_else(|| PathBuf::from("")),
        test_srcdir.join("_main").join(&value),
        test_workspace
            .as_ref()
            .map(|workspace| test_srcdir.join(workspace).join("packages/dashql-native").join(file_name))
            .unwrap_or_else(|| PathBuf::from("")),
        test_srcdir.join("_main").join("packages/dashql-native").join(file_name),
    ];
    for candidate in candidates {
        if !candidate.as_os_str().is_empty() && candidate.exists() {
            return Ok(candidate.to_string_lossy().into_owned());
        }
    }

    anyhow::bail!("failed to resolve path from environment variable {name}: {value}")
}

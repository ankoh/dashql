use std::fs;
use std::path::Path;
use std::path::PathBuf;
use std::process;
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::bail;
use anyhow::Context;
use anyhow::Result;

static NEXT_TEMP_ID: AtomicUsize = AtomicUsize::new(1);

pub struct GrpcTlsTestCerts {
    temp_dir: PathBuf,
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
        let temp_dir = std::env::temp_dir().join(format!(
            "dashql-grpc-tls-{}-{}-{}",
            process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos(),
            NEXT_TEMP_ID.fetch_add(1, Ordering::SeqCst),
        ));
        fs::create_dir_all(&temp_dir)?;

        let test_ca = generate_ca(&temp_dir, "ca", "DashQL Test CA")?;
        let wrong_ca = generate_ca(&temp_dir, "wrong_ca", "DashQL Wrong Test CA")?;

        let server_identity = generate_leaf_cert(&temp_dir, "server", "localhost", &test_ca, true)?;
        let client_identity = generate_leaf_cert(&temp_dir, "client", "DashQL Test Client", &test_ca, false)?;
        let wrong_client_identity = generate_leaf_cert(&temp_dir, "wrong_client", "DashQL Wrong Test Client", &wrong_ca, false)?;

        Ok(Self {
            temp_dir,
            ca_cert_path: test_ca.cert_path,
            server_cert_path: server_identity.cert_path,
            server_key_path: server_identity.key_path,
            client_cert_path: client_identity.cert_path,
            client_key_path: client_identity.key_path,
            wrong_ca_cert_path: wrong_ca.cert_path,
            wrong_client_cert_path: wrong_client_identity.cert_path,
            wrong_client_key_path: wrong_client_identity.key_path,
        })
    }
}

impl Drop for GrpcTlsTestCerts {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.temp_dir);
    }
}

struct CertificateAuthorityPaths {
    cert_path: String,
    key_path: String,
    serial_path: String,
}

struct CertificateIdentityPaths {
    cert_path: String,
    key_path: String,
}

fn generate_ca(temp_dir: &Path, base_name: &str, common_name: &str) -> Result<CertificateAuthorityPaths> {
    let config_path = temp_dir.join(format!("{}.cnf", base_name));
    let key_path = temp_dir.join(format!("{}.key", base_name));
    let cert_path = temp_dir.join(format!("{}.crt", base_name));
    let serial_path = temp_dir.join(format!("{}.srl", base_name));
    fs::write(
        &config_path,
        format!(
            "[ req ]\ndistinguished_name = dn\nx509_extensions = v3_ca\nprompt = no\n[ dn ]\nCN = {}\nO = DashQL\nC = DE\n[ v3_ca ]\nbasicConstraints = critical, CA:true\nkeyUsage = critical, keyCertSign, cRLSign\nsubjectKeyIdentifier = hash\nauthorityKeyIdentifier = keyid:always,issuer\n",
            common_name,
        ),
    )?;

    run_openssl(temp_dir, &["genrsa", "-out", key_path.to_str().unwrap(), "2048"])?;
    run_openssl(
        temp_dir,
        &[
            "req",
            "-x509",
            "-new",
            "-nodes",
            "-key",
            key_path.to_str().unwrap(),
            "-sha256",
            "-days",
            "3650",
            "-out",
            cert_path.to_str().unwrap(),
            "-config",
            config_path.to_str().unwrap(),
        ],
    )?;

    Ok(CertificateAuthorityPaths {
        cert_path: cert_path.to_string_lossy().into_owned(),
        key_path: key_path.to_string_lossy().into_owned(),
        serial_path: serial_path.to_string_lossy().into_owned(),
    })
}

fn generate_leaf_cert(
    temp_dir: &Path,
    base_name: &str,
    common_name: &str,
    ca: &CertificateAuthorityPaths,
    is_server: bool,
) -> Result<CertificateIdentityPaths> {
    let config_path = temp_dir.join(format!("{}.cnf", base_name));
    let key_path = temp_dir.join(format!("{}.key", base_name));
    let csr_path = temp_dir.join(format!("{}.csr", base_name));
    let cert_path = temp_dir.join(format!("{}.crt", base_name));
    let config = if is_server {
        format!(
            "[ req ]\ndistinguished_name = dn\nreq_extensions = req_ext\nprompt = no\n[ dn ]\nCN = {}\nO = DashQL\nC = DE\n[ req_ext ]\nsubjectAltName = @alt_names\nextendedKeyUsage = serverAuth\nkeyUsage = digitalSignature, keyEncipherment\n[ alt_names ]\nDNS.1 = localhost\nIP.1 = 127.0.0.1\n",
            common_name,
        )
    } else {
        format!(
            "[ req ]\ndistinguished_name = dn\nreq_extensions = req_ext\nprompt = no\n[ dn ]\nCN = {}\nO = DashQL\nC = DE\n[ req_ext ]\nextendedKeyUsage = clientAuth\nkeyUsage = digitalSignature, keyEncipherment\n",
            common_name,
        )
    };
    fs::write(&config_path, config)?;

    run_openssl(temp_dir, &["genrsa", "-out", key_path.to_str().unwrap(), "2048"])?;
    run_openssl(
        temp_dir,
        &[
            "req",
            "-new",
            "-key",
            key_path.to_str().unwrap(),
            "-out",
            csr_path.to_str().unwrap(),
            "-config",
            config_path.to_str().unwrap(),
        ],
    )?;
    run_openssl(
        temp_dir,
        &[
            "x509",
            "-req",
            "-in",
            csr_path.to_str().unwrap(),
            "-CA",
            &ca.cert_path,
            "-CAkey",
            &ca.key_path,
            "-CAserial",
            &ca.serial_path,
            "-CAcreateserial",
            "-out",
            cert_path.to_str().unwrap(),
            "-days",
            "3650",
            "-sha256",
            "-extensions",
            "req_ext",
            "-extfile",
            config_path.to_str().unwrap(),
        ],
    )?;

    Ok(CertificateIdentityPaths {
        cert_path: cert_path.to_string_lossy().into_owned(),
        key_path: key_path.to_string_lossy().into_owned(),
    })
}

fn run_openssl(temp_dir: &Path, args: &[&str]) -> Result<()> {
    let output = Command::new("openssl")
        .args(args)
        .current_dir(temp_dir)
        .output()
        .with_context(|| format!("failed to execute openssl with args {:?}", args))?;
    if !output.status.success() {
        bail!(
            "openssl {:?} failed with status {}: {}",
            args,
            output.status,
            String::from_utf8_lossy(&output.stderr),
        );
    }
    Ok(())
}

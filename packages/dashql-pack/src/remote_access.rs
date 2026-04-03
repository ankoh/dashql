use anyhow::Result;
use std::env;

pub struct RemoteAccess {
    pub r2_endpoint: String,
    pub r2_access_key_id: String,
    pub r2_secret_access_key: String,
    pub bucket: String,
}

impl RemoteAccess {
    pub fn from_env(prefix: &str, bucket: &str) -> Result<RemoteAccess> {
        let endpoint_var = format!("{}_R2_ENDPOINT", prefix);
        let access_key_var = format!("{}_R2_ACCESS_KEY_ID", prefix);
        let secret_key_var = format!("{}_R2_SECRET_ACCESS_KEY", prefix);

        let r2_endpoint = env::var(&endpoint_var).map_err(|e| {
            anyhow::anyhow!(
                "failed to access environment variable {}: {}",
                &endpoint_var,
                e
            )
        })?;
        let r2_access_key_id = env::var(&access_key_var).map_err(|e| {
            anyhow::anyhow!(
                "failed to access environment variable {}: {}",
                &access_key_var,
                e
            )
        })?;
        let r2_secret_access_key = env::var(&secret_key_var).map_err(|e| {
            anyhow::anyhow!(
                "failed to access environment variable {}: {}",
                &secret_key_var,
                e
            )
        })?;
        assert!(!r2_endpoint.is_empty());
        assert!(!r2_access_key_id.is_empty());
        assert!(!r2_secret_access_key.is_empty());
        Ok(RemoteAccess {
            r2_endpoint,
            r2_access_key_id,
            r2_secret_access_key,
            bucket: bucket.to_string(),
        })
    }

    pub fn build_client(&self) -> aws_sdk_s3::Client {
        let credentials = aws_credential_types::Credentials::new(
            self.r2_access_key_id.clone(),
            self.r2_secret_access_key.clone(),
            None,
            None,
            "r2",
        );
        let r2_region = aws_config::Region::new("auto");
        let r2_credential_provider =
            aws_credential_types::provider::SharedCredentialsProvider::new(credentials);
        let r2_config = aws_sdk_s3::Config::builder()
            .behavior_version_latest()
            .endpoint_url(&self.r2_endpoint)
            .region(r2_region)
            .credentials_provider(r2_credential_provider)
            .build();
        aws_sdk_s3::Client::from_conf(r2_config)
    }
}

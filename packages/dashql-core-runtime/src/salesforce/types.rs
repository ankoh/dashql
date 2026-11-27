//! The values of a Salesforce connection: params, tokens, user info and metadata, in the JSON of
//! `proto/json/dashql/connection.json`, so they cross to the host and the connection state as they did.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::connections::{JsonObject, HYPER_CLOUD_DEFAULT_DATABASE_NAME};

/// The params of a Salesforce or Database.com connection
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SalesforceConnectionParams {
    /// The instance, such as `https://org.my.salesforce.com`
    pub instance_url: String,
    /// The consumer key of the connected app
    pub app_consumer_key: String,
    /// The consumer secret of the connected app, empty for PKCE alone
    pub app_consumer_secret: String,
    /// The login hint
    pub login: String,
    /// Database.com only: the Hyper Cloud database
    #[serde(skip_serializing_if = "Option::is_none")]
    pub database_name: Option<String>,
}

impl SalesforceConnectionParams {
    /// Read the params of a connection
    pub fn from_object(params: &JsonObject) -> Self {
        serde_json::from_value(Value::Object(params.clone())).unwrap_or_default()
    }

    /// The database of a Database.com connection
    pub fn hyper_cloud_database(&self) -> &str {
        self.database_name.as_deref().filter(|d| !d.is_empty()).unwrap_or(HYPER_CLOUD_DEFAULT_DATABASE_NAME)
    }
}

/// How the app receives the OAuth redirect
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SalesforceOAuthConfig {
    /// The redirect page of the app
    pub oauth_redirect: String,
}

/// The access token of the core login, opaque to the client
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SalesforceCoreAccessToken {
    pub created_at: String,
    pub access_token: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_instance_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instance_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issued_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_type: Option<String>,
}

/// The decoded JWT of Data Cloud
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct SalesforceDataCloudJwt {
    /// The token as it was issued
    pub raw: String,
    pub header: Value,
    pub payload: Value,
}

/// The access token of Data Cloud, a JWT that the tenant accepts
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SalesforceDataCloudAccessToken {
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issued_token_type: Option<String>,
    /// When the token expires, ISO 8601
    pub expires_at: String,
    pub jwt: SalesforceDataCloudJwt,
    /// The tenant, an HTTPS origin with a trailing slash
    pub instance_url: String,
}

/// The tokens of a Salesforce login, the channel of a connection holds them
#[derive(Debug, Clone, Default, PartialEq)]
pub struct SalesforceTokens {
    pub core: SalesforceCoreAccessToken,
    pub data_cloud: SalesforceDataCloudAccessToken,
}

/// The user of the core login
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SalesforceCoreUserInfo {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email_verified: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub family_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub given_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_app_installed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_salesforce_integration_user: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locale: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nickname: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub organization_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub photos: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub picture: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preferred_username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sub: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub utc_offset: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zoneinfo: Option<String>,
}

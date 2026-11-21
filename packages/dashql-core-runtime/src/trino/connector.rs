//! The Trino connector, see `connections::connector`.

use serde_json::{json, Value};

use crate::catalog_loader::trino::TrinoCatalogUpdate;
use crate::catalog_loader::{CatalogEntries, ConnectorCatalogUpdate};
use crate::connections::connector::Connector;
use crate::connections::is_truthy;
use crate::connections::sharing::without;
use crate::connections::{
    object, trino_session_defaults, CatalogNameDefaults, ConnectionChannel, ConnectionDetails, ConnectorFeatures,
    ConnectorType, JsonObject, RelationName, Timestamp,
};

/// The Trino connector
pub struct TrinoConnector;

/// The Trino connector of the runtime
pub static TRINO: TrinoConnector = TrinoConnector;

impl Connector for TrinoConnector {
    fn connector_type(&self) -> ConnectorType {
        ConnectorType::Trino
    }

    fn params_key(&self) -> &'static str {
        "trino"
    }

    fn display_name(&self) -> &'static str {
        "Trino"
    }

    fn features(&self) -> ConnectorFeatures {
        ConnectorFeatures { read_only: true }
    }

    fn default_params(&self) -> JsonObject {
        object(json!({ "endpoint": "", "catalogs": [], "auth": { "authType": "AUTH_BASIC" } }))
    }

    fn has_draft_rows(&self) -> bool {
        true
    }

    fn health_probe(&self) -> &'static str {
        "select 1"
    }

    /// The basic-auth secret goes, the user name is the login hint. Request headers may carry credentials.
    fn shared_params(&self, params: &JsonObject, with_login_hint: bool) -> JsonObject {
        let mut trino = without(params, &["draftRows", "metadata"]);
        let mut auth = params.get("auth").and_then(Value::as_object).cloned().unwrap_or_default();
        if let Some(basic) = auth.get("basic").filter(|basic| is_truthy(basic)) {
            let mut basic = basic.as_object().cloned().unwrap_or_default();
            basic.insert("secret".into(), json!(""));
            if !with_login_hint {
                basic.insert("username".into(), json!(""));
            }
            auth.insert("basic".into(), Value::Object(basic));
        }
        trino.insert("auth".into(), Value::Object(auth));
        trino
    }

    fn login_hint(&self, params: &JsonObject) -> Option<String> {
        crate::trino::descriptor::login_hint(params)
    }

    fn label_location(&self, params: &JsonObject) -> Option<String> {
        Some(params.get("endpoint").and_then(Value::as_str).unwrap_or("").to_string())
    }

    /// The relations of statements get the defaults of the requests
    fn catalog_name_defaults(&self, setup_params: Option<&JsonObject>) -> CatalogNameDefaults {
        let defaults = setup_params.map(trino_session_defaults).unwrap_or_default();
        CatalogNameDefaults {
            database_name: defaults.catalog.unwrap_or_default(),
            schema_name: defaults.schema.unwrap_or_default(),
        }
    }

    fn catalog_update(
        &self,
        details: &ConnectionDetails,
        entries: CatalogEntries,
        relations: Option<Vec<RelationName>>,
        _now: Timestamp,
    ) -> Box<dyn ConnectorCatalogUpdate> {
        let setup_params = details.setup_params.clone().unwrap_or_default();
        Box::new(TrinoCatalogUpdate::new(&setup_params, entries, relations))
    }

    fn cache_signature(&self, params: &JsonObject) -> Value {
        crate::trino::descriptor::cache_signature(params)
    }

    /// A login with OAuth keys its results by the account of its token
    fn sign_login(&self, signature: &mut Value, setup_params: &JsonObject, details: &ConnectionDetails) -> Option<()> {
        let oauth = setup_params.get("auth").and_then(|auth| auth.get("authType")).and_then(Value::as_str)
            == Some("AUTH_OAUTH");
        if oauth {
            let token =
                details.channel.as_ref().and_then(ConnectionChannel::trino).and_then(|trino| trino.access_token());
            let principal = token.and_then(|token| token.principal)?;
            let auth = signature.get_mut("auth").and_then(Value::as_object_mut)?;
            auth.insert("principal".to_string(), Value::String(principal));
        }
        Some(())
    }
}

//! The Salesforce connectors, see `connections::connector`: Salesforce Data Cloud, and Database.com, which logs in like
//! Salesforce and queries the Hyper of a Hyper Cloud database.

use serde_json::{json, Value};

use crate::catalog_loader::hyper::HyperCatalogUpdate;
use crate::catalog_loader::salesforce::SalesforceCatalogUpdate;
use crate::catalog_loader::{CatalogEntries, ConnectorCatalogUpdate};
use crate::clfn::ClientFunctionBinding;
use crate::connections::connector::Connector;
use crate::connections::{
    object, CatalogNameDefaults, ConnectionDetails, ConnectorFeatures, ConnectorType, JsonObject, RelationName,
    Timestamp, HYPER_CLOUD_DEFAULT_DATABASE_NAME, SALESFORCE_CATALOG_DATABASE, SALESFORCE_CATALOG_SCHEMA,
};

/// A Salesforce connector
pub struct SalesforceConnector {
    connector_type: ConnectorType,
}

/// The Salesforce Data Cloud connector of the runtime
pub static SALESFORCE_DATA_CLOUD: SalesforceConnector =
    SalesforceConnector { connector_type: ConnectorType::SalesforceDataCloud };

/// The Database.com connector of the runtime
pub static DBCOM: SalesforceConnector = SalesforceConnector { connector_type: ConnectorType::Dbcom };

impl SalesforceConnector {
    fn is_dbcom(&self) -> bool {
        self.connector_type == ConnectorType::Dbcom
    }
}

impl Connector for SalesforceConnector {
    fn connector_type(&self) -> ConnectorType {
        self.connector_type
    }

    fn params_key(&self) -> &'static str {
        if self.is_dbcom() {
            "dbcom"
        } else {
            "salesforce"
        }
    }

    fn display_name(&self) -> &'static str {
        if self.is_dbcom() {
            "Database.com"
        } else {
            "Salesforce Data Cloud"
        }
    }

    /// Data Cloud only reads, a Hyper Cloud database of Database.com is written as well
    fn features(&self) -> ConnectorFeatures {
        ConnectorFeatures { query_result_caching: true, read_only: !self.is_dbcom() }
    }

    fn default_params(&self) -> JsonObject {
        let mut params =
            object(json!({ "instanceUrl": "", "appConsumerKey": "", "appConsumerSecret": "", "login": "" }));
        if self.is_dbcom() {
            params.insert("databaseName".to_string(), json!(HYPER_CLOUD_DEFAULT_DATABASE_NAME));
        }
        params
    }

    /// The secret of the connected app goes, the login is the login hint
    fn shared_params(&self, params: &JsonObject, with_login_hint: bool) -> JsonObject {
        let mut salesforce = params.clone();
        salesforce.insert("appConsumerSecret".into(), json!(""));
        if !with_login_hint {
            salesforce.insert("login".into(), json!(""));
        }
        salesforce
    }

    fn login_hint(&self, params: &JsonObject) -> Option<String> {
        crate::salesforce::login_hint(params).map(str::to_string)
    }

    fn label_location(&self, params: &JsonObject) -> Option<String> {
        Some(params.get("instanceUrl").and_then(Value::as_str).unwrap_or("").to_string())
    }

    fn catalog_name_defaults(&self, _setup_params: Option<&JsonObject>) -> CatalogNameDefaults {
        CatalogNameDefaults {
            database_name: SALESFORCE_CATALOG_DATABASE.to_string(),
            schema_name: SALESFORCE_CATALOG_SCHEMA.to_string(),
        }
    }

    /// Data Cloud reads its metadata over the API and refreshes in full, Database.com queries the Hyper of its Hyper
    /// Cloud database
    fn catalog_update(
        &self,
        details: &ConnectionDetails,
        entries: CatalogEntries,
        relations: Option<Vec<RelationName>>,
        now: Timestamp,
    ) -> Box<dyn ConnectorCatalogUpdate> {
        if self.is_dbcom() {
            let setup_params = details.setup_params.clone().unwrap_or_default();
            Box::new(HyperCatalogUpdate::of_dbcom(&setup_params, entries, relations, now))
        } else {
            Box::new(SalesforceCatalogUpdate::new(details, entries))
        }
    }

    /// Data Cloud has the Data 360 API. It isn't known whether Database.com has it.
    fn client_functions(&self) -> Option<&'static dyn ClientFunctionBinding> {
        (!self.is_dbcom())
            .then_some(&crate::salesforce::client_functions::DATA_360 as &'static dyn ClientFunctionBinding)
    }

    fn cache_signature(&self, params: &JsonObject) -> Value {
        crate::salesforce::cache_signature(self.connector_type, params)
    }

    /// A login keys its results by the account of its user info, never by a hint that the user typed
    fn sign_login(&self, signature: &mut Value, _setup_params: &JsonObject, details: &ConnectionDetails) -> Option<()> {
        let principal = details.salesforce().and_then(|salesforce| salesforce.principal.clone())?;
        signature.as_object_mut()?.insert("login".to_string(), Value::String(principal));
        Some(())
    }
}

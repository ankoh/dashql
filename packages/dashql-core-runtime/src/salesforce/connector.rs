//! The Salesforce connectors, see `connections::connector`: Salesforce Data Cloud, and Database.com, which logs in like
//! Salesforce and queries the Hyper of a Hyper Cloud database.

use serde_json::json;

use crate::connections::connector::Connector;
use crate::connections::{object, ConnectorFeatures, ConnectorType, JsonObject, HYPER_CLOUD_DEFAULT_DATABASE_NAME};

/// A Salesforce connector
pub struct SalesforceConnector {
    connector_type: ConnectorType,
}

/// The Salesforce Data Cloud connector of the runtime
pub static SALESFORCE_DATA_CLOUD: SalesforceConnector = SalesforceConnector { connector_type: ConnectorType::SalesforceDataCloud };

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
        let mut params = object(json!({ "instanceUrl": "", "appConsumerKey": "", "appConsumerSecret": "", "login": "" }));
        if self.is_dbcom() {
            params.insert("databaseName".to_string(), json!(HYPER_CLOUD_DEFAULT_DATABASE_NAME));
        }
        params
    }
}

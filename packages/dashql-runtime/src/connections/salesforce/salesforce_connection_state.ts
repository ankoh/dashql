import { ConnectorType } from '../connector_info.js';
import type { ConnectionState } from '../connection_state.js';

// The runtime sets up Salesforce and Database.com connections and applies the steps of a setup
// (`packages/dashql-core-runtime/src/salesforce/`)

/// The details of a Salesforce or Database.com connection, null for another connector
export function getSalesforceConnectionDetails(state: ConnectionState | null): ConnectionState['details'] | null {
    return state?.connectorType === ConnectorType.SALESFORCE_DATA_CLOUD || state?.connectorType === ConnectorType.DBCOM ? state.details : null;
}

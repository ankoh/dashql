import { ConnectorType, HYPER_CONNECTOR, SALESFORCE_DATA_CLOUD_CONNECTOR, SIDB_CONNECTOR, TRINO_CONNECTOR } from "./connector_info.js";
import { VariantKind } from "../../utils/variant.js";
import type { HyperConnectionDetails } from "./hyper/hyper_connection_state.js";
import type { SalesforceConnectionStateDetails } from "./salesforce/salesforce_connection_state.js";
import type { TrinoConnectionStateDetails } from "./trino/trino_connection_state.js";
import { CONNECTOR_DESCRIPTORS, connectionStateDetailsOf } from "./connector_descriptor.js";

/// The connectors that share the Salesforce connection state, SIDB behaves like Salesforce Data Cloud for now
export type SalesforceDetailsType = typeof SALESFORCE_DATA_CLOUD_CONNECTOR | typeof SIDB_CONNECTOR;

export type ConnectionStateDetailsVariant =
    | VariantKind<SalesforceDetailsType, SalesforceConnectionStateDetails>
    | VariantKind<typeof HYPER_CONNECTOR, HyperConnectionDetails>
    | VariantKind<typeof TRINO_CONNECTOR, TrinoConnectionStateDetails>
    ;

/// The details of a new connection of a connector
export function createConnectionStateDetails(type: ConnectorType): ConnectionStateDetailsVariant {
    const connector = CONNECTOR_DESCRIPTORS[type];
    return connectionStateDetailsOf(connector, connector.defaultParams());
}

/// Do the details hold the Salesforce connection state?
export function isSalesforceDetails(details: ConnectionStateDetailsVariant): details is VariantKind<SalesforceDetailsType, SalesforceConnectionStateDetails> {
    return details.type === SALESFORCE_DATA_CLOUD_CONNECTOR || details.type === SIDB_CONNECTOR;
}

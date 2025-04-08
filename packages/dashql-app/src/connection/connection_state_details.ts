import { ConnectorType, DEMO_CONNECTOR, HYPER_GRPC_CONNECTOR, SALESFORCE_DATA_CLOUD_CONNECTOR, SERVERLESS_CONNECTOR, TRINO_CONNECTOR } from "./connector_info.js";
import { VariantKind } from "../utils/variant.js";
import { createDemoConnectionStateDetails, DemoConnectionStateDetails } from "./demo/demo_connection_state.js";
import { createHyperGrpcConnectionStateDetails, HyperGrpcConnectionDetails } from "./hyper/hyper_connection_state.js";
import { createSalesforceConnectionStateDetails, SalesforceConnectionStateDetails } from "./salesforce/salesforce_connection_state.js";
import { createTrinoConnectionStateDetails, TrinoConnectionStateDetails } from "./trino/trino_connection_state.js";

export type ConnectionStateDetailsVariant =
    | VariantKind<typeof SALESFORCE_DATA_CLOUD_CONNECTOR, SalesforceConnectionStateDetails>
    | VariantKind<typeof SERVERLESS_CONNECTOR, {}>
    | VariantKind<typeof DEMO_CONNECTOR, DemoConnectionStateDetails>
    | VariantKind<typeof HYPER_GRPC_CONNECTOR, HyperGrpcConnectionDetails>
    | VariantKind<typeof TRINO_CONNECTOR, TrinoConnectionStateDetails>
    ;

export function createConnectionStateDetails(type: ConnectorType): ConnectionStateDetailsVariant {
    switch (type) {
        case ConnectorType.DEMO:
            return {
                type: DEMO_CONNECTOR,
                value: createDemoConnectionStateDetails()
            };
        case ConnectorType.TRINO:
            return {
                type: TRINO_CONNECTOR,
                value: createTrinoConnectionStateDetails(),
            };
        case ConnectorType.HYPER_GRPC:
            return {
                type: HYPER_GRPC_CONNECTOR,
                value: createHyperGrpcConnectionStateDetails(),
            };
        case ConnectorType.SALESFORCE_DATA_CLOUD:
            return {
                type: SALESFORCE_DATA_CLOUD_CONNECTOR,
                value: createSalesforceConnectionStateDetails(),
            };
        case ConnectorType.SERVERLESS:
            return {
                type: SERVERLESS_CONNECTOR,
                value: {},
            };
    }
}

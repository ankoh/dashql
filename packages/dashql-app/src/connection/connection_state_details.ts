import { ConnectorType, DEMO_CONNECTOR, HYPER_GRPC_CONNECTOR, SALESFORCE_DATA_CLOUD_CONNECTOR, SERVERLESS_CONNECTOR, TRINO_CONNECTOR } from "./connector_info.js";
import { VariantKind } from "../utils/variant.js";
import { computeDemoConnectionSignature, createDemoConnectionStateDetails, DemoConnectionStateDetails } from "./demo/demo_connection_state.js";
import { computeHyperGrpcConnectionSignature, createHyperGrpcConnectionStateDetails, HyperGrpcConnectionDetails } from "./hyper/hyper_connection_state.js";
import { computeSalesforceConnectionSignature, createSalesforceConnectionStateDetails, SalesforceConnectionStateDetails } from "./salesforce/salesforce_connection_state.js";
import { computeTrinoConnectionSignature, createTrinoConnectionStateDetails, TrinoConnectionStateDetails } from "./trino/trino_connection_state.js";
import { Hasher } from "../utils/hash.js";
import { DefaultHasher } from "../utils/hash_default.js";
import { computeDatalessConnectionSignature } from "./dataless/dataless_connection_details.js";

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

export function computeConnectionSignatureFromDetails(state: ConnectionStateDetailsVariant, hasher: Hasher) {
    switch (state.type) {
        case DEMO_CONNECTOR:
            return computeDemoConnectionSignature(state.value, hasher);
        case TRINO_CONNECTOR:
            return computeTrinoConnectionSignature(state.value, hasher);
        case HYPER_GRPC_CONNECTOR:
            return computeHyperGrpcConnectionSignature(state.value, hasher);
        case SALESFORCE_DATA_CLOUD_CONNECTOR:
            return computeSalesforceConnectionSignature(state.value, hasher);
        case SERVERLESS_CONNECTOR:
            return computeDatalessConnectionSignature(state.value, hasher);
    }
}

export function computeNewConnectionSignatureFromDetails(state: ConnectionStateDetailsVariant): Hasher {
    const sig = new DefaultHasher();
    computeConnectionSignatureFromDetails(state, sig);
    return sig;
}

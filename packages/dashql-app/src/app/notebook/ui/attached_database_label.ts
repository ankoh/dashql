import type { AttachedDatabaseState } from '../connections/attached_database_state.js';
import { HYPER_CONNECTOR, SALESFORCE_DATA_CLOUD_CONNECTOR } from '../connections/connector_info.js';

export function isHyperWasmAttachedDatabase(database: AttachedDatabaseState): boolean {
    return database.details.type === HYPER_CONNECTOR &&
        (database.details.value.proto.setupParams?.protocol ?? 'WASM') === 'WASM';
}

export function attachedDatabaseLabel(database: AttachedDatabaseState): string {
    if (isHyperWasmAttachedDatabase(database)) return 'Memory';
    let protocol = 'HTTP';
    if (database.details.type === HYPER_CONNECTOR) {
        const value = database.details.value.proto.setupParams?.protocol;
        protocol = value === 'V3_DOCKER' ? 'Docker'
            : value === 'V3_GRPC' ? 'gRPC'
                : value === 'V3_HTTP' ? 'HTTP'
                    : 'WASM';
    } else if (database.details.type === SALESFORCE_DATA_CLOUD_CONNECTOR) {
        const value = database.details.value.proto.setupParams?.hyperProtocol;
        protocol = value === 'V3_GRPC' ? 'gRPC' : value === 'V3_DOCKER' ? 'Docker' : value === 'WASM' ? 'WASM' : 'HTTP';
    }
    return `${database.connectorInfo.names.displayLong} / ${protocol}`;
}

import type { DatalessParams } from '../connection_params.js';

export interface DatalessConnectionParams {
    demoConnector?: boolean;
}

export function readDatalessConnectionParamsFromProto(params: DatalessParams): DatalessConnectionParams {
    return {
        demoConnector: (params as any)?.demoConnector ?? false,
    };
}

export function createDatalessConnectionParamsSignature(params: DatalessParams): any {
    const demoConnector = (params as any)?.demoConnector ?? false;
    return { case: "dataless", demoConnector };
}

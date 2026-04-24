import type { DatalessParams } from '../connection_params.js';

export interface DatalessConnectionParams {
    demoMode?: boolean;
}

export function readDatalessConnectionParamsFromProto(params: DatalessParams): DatalessConnectionParams {
    return {
        demoMode: (params as any)?.demoMode ?? false,
    };
}

export function createDatalessConnectionParamsSignature(params: DatalessParams): any {
    const demoMode = (params as any)?.demoMode ?? false;
    return { case: "dataless", demoMode };
}

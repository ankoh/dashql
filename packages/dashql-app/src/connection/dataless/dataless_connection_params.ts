import type { DatalessParams } from '../connection_params.js';

export interface DatalessConnectionParams { }

export function readDatalessConnectionParamsFromProto(_params: DatalessParams): DatalessConnectionParams {
    return {};
}

export function createDatalessConnectionParamsSignature(_params: DatalessParams): any {
    return { case: "dataless" };
}

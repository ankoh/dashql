import * as pb from '@ankoh/dashql-protobuf';

export interface DatalessConnectionParams { }

export function readDatalessConnectionParamsFromProto(_params: pb.dashql.connection.DatalessParams): DatalessConnectionParams {
    return {};
}

export function createDatalessConnectionParamsSignature(_params: pb.dashql.connection.DatalessParams): any {
    return { case: "dataless" };
}

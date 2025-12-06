import * as pb from '@ankoh/dashql-protobuf';

export interface ServerlessConnectionParams { }

export function readServerlessConnectionParamsFromProto(_params: pb.dashql.connection.ServerlessParams): ServerlessConnectionParams {
    return {};
}

export function createServerlessConnectionParamsSignature(_params: pb.dashql.connection.ServerlessParams): any {
    return { case: "serverless" };
}

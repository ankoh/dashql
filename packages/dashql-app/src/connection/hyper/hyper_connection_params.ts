import * as pb from '@ankoh/dashql-protobuf';

export function createHyperConnectionParamsSignature(params: pb.dashql.connection.HyperConnectionParams): any {
    return {
        case: "hyper",
        channelArgs: {
            endpoint: params.endpoint,
            tls: params.tls
        },
        attachedDatabases: params.attachedDatabases
            .map(d => ({ path: d.path, alias: d.alias }))
            .sort((a, b) => a.path > b.path ? 1 : -1),
        gRPCMetadata: Object.entries(params.metadata).sort(([a,], [b]) => a > b ? 1 : -1)
    };
}

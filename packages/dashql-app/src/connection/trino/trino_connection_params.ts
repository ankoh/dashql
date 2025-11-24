import * as pb from '@ankoh/dashql-protobuf';

export function createTrinoConnectionParamsSignature(params: pb.dashql.connection.TrinoConnectionParams): any {
    return {
        case: "trino",
        endpoint: params.endpoint,
        auth: {
            username: params.auth?.username,
        },
        catalog: params.catalogName,
        schemas: params.schemaNames.sort((a, b) => a > b ? 1 : -1)
    };
}

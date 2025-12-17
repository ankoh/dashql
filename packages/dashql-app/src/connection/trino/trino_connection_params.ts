import * as pb from '@ankoh/dashql-protobuf';

export function createTrinoConnectionParamsSignature(params: pb.dashql.connection.TrinoConnectionParams): any {
    return {
        case: "trino",
        endpoint: params.endpoint,
        auth: {
            authType: params.auth?.authType,
            basicUsername: params.auth?.basic?.username,
            oauthAuthEndpoint: params.auth?.oauth?.authorizationEndpoint,
            oauthTokenEndpoint: params.auth?.oauth?.tokenEndpoint,
            oauthRedirectUrl: params.auth?.oauth?.callbackUrl,
            oauthClientId: params.auth?.oauth?.clientId,
            oauthScopes: params.auth?.oauth?.scopes,
        },
        catalog: params.catalogName,
        schemas: params.schemaNames.sort((a, b) => a > b ? 1 : -1)
    };
}

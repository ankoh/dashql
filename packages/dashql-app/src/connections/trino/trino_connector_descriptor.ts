import type { ConnectorDescriptor } from '../connector_descriptor.js';
import { CONNECTOR_INFOS, ConnectorType, TRINO_CONNECTOR } from '../connector_info.js';
import { createTrinoConnectionStateDetails, reduceTrinoConnectorState } from './trino_connection_state.js';
import { queryParam, requireChannel } from '../query_channel.js';

/// Trino connections
export const TRINO_CONNECTOR_DESCRIPTOR: ConnectorDescriptor<'trino'> = {
    info: CONNECTOR_INFOS[ConnectorType.TRINO],
    paramsKey: 'trino',
    detailsType: TRINO_CONNECTOR,
    defaultParams: () => ({ endpoint: '', catalogs: [], auth: { authType: 'AUTH_BASIC' } }),
    createDetails: createTrinoConnectionStateDetails,
    reduce: reduceTrinoConnectorState,
    withoutDraftRows: ({ draftRows: _rows, ...params }) => params,
    sanitizeForSharing(params, withLoginHint) {
        // Keep endpoint, catalogs and the basic-auth username; drop the basic-auth secret /
        // access token. OAuth params (client id + urls) carry no secret and are left as-is.
        // The basic-auth username doubles as the login hint here.
        // Arbitrary request headers may carry credentials under any name.
        const { metadata: _metadata, ...trino } = params;
        return {
            ...trino,
            auth: {
                ...trino.auth,
                ...(trino.auth?.basic ? { basic: { ...trino.auth.basic, secret: "", ...(withLoginHint ? {} : { username: "" }) } } : {}),
            },
        };
    },
    loginHint: params => params.auth?.basic?.username || null,
    cacheSignature: params => ({
        case: "trino",
        endpoint: params.endpoint,
        auth: {
            authType: params.auth?.authType,
            basicUsername: params.auth?.basic?.username,
            oauthAuthUrl: params.auth?.oauth?.authorizationUrl,
            oauthTokenUrl: params.auth?.oauth?.tokenUrl,
            oauthRedirectUrl: params.auth?.oauth?.callbackUrl,
            oauthClientId: params.auth?.oauth?.clientId,
            oauthScopes: params.auth?.oauth?.scopes,
        },
        // The catalogs only decide which relations the catalog loader reads, queries name their catalogs
    }),
    // Requests set no default catalog or schema, statements name both
    catalogNameDefaults: () => ({ databaseName: '', schemaName: '' }),
    executeQuery: (details, args, abort) => requireChannel(args.channelOverride?.type === 'trino' ? args.channelOverride.channel : details.channel, 'Trino')
        .executeQuery(queryParam(args), abort),
    maxConcurrentQueries: () => 1,
    catalogIsDurable: () => true,
    readsAttachments: () => false,
};

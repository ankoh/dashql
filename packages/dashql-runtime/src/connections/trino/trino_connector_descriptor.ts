import type { ConnectorDescriptor } from '../connector_descriptor.js';
import { CONNECTOR_INFOS, ConnectorType } from '../connector_info.js';
import { trinoSessionDefaults } from './trino_catalogs.js';

/// Trino connections
export const TRINO_CONNECTOR_DESCRIPTOR: ConnectorDescriptor<'trino'> = {
    info: CONNECTOR_INFOS[ConnectorType.TRINO],
    paramsKey: 'trino',
    defaultParams: () => ({ endpoint: '', catalogs: [], auth: { authType: 'AUTH_BASIC' } }),
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
    // The credentials and the user stay out, a new token or another login reuses the cached results
    cacheSignature: params => ({
        case: "trino",
        endpoint: params.endpoint,
        auth: {
            authType: params.auth?.authType,
            oauthAuthUrl: params.auth?.oauth?.authorizationUrl,
            oauthTokenUrl: params.auth?.oauth?.tokenUrl,
            oauthRedirectUrl: params.auth?.oauth?.callbackUrl,
            oauthClientId: params.auth?.oauth?.clientId,
            oauthScopes: params.auth?.oauth?.scopes,
        },
        // The defaults resolve the names that statements leave out, the catalogs only decide what the catalog loader reads
        defaults: trinoSessionDefaults(params),
    }),
    maxConcurrentQueries: () => 1,
    catalogIsDurable: () => true,
    readsAttachments: () => false,
};

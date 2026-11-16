import * as connection from '@akohn/dashql-jsonschema/connection.js';

// The setup, the token exchange, the channel and the metadata of Salesforce are the runtime's (`salesforce/` of the
// runtime crate). The platform shows what the login of the shell returns of the tokens.

/// The Data Cloud auth infos
export interface SalesforceAuthInfo {
    /// The core tenant id
    coreTenantId: string | null;
    /// The core access token
    coreAccessToken: string | null;
    /// The offcore jwt
    offcoreRawJwt: string;
    /// The offcore instance url
    offcoreInstanceUrl: string | null;
    /// The offcore tenant id
    offcoreTenantId: string | null;
    /// The offcore access token
    offcoreAccessToken: string | null;
}

export function collectSalesforceAuthInfo(coreToken: connection.SalesforceCoreAccessToken, offcoreToken: connection.SalesforceDataCloudAccessToken): SalesforceAuthInfo | null {
    const jwt = offcoreToken?.jwt;
    if (jwt) {
        return {
            offcoreRawJwt: jwt.raw,
            offcoreInstanceUrl: offcoreToken?.instanceUrl ?? null,
            offcoreTenantId: jwt.payload?.audienceTenantId ?? null,
            offcoreAccessToken: null,
            coreTenantId: jwt.payload?.audienceTenantId ?? null,
            coreAccessToken: coreToken?.accessToken ?? null,
        };
    } else {
        return null;
    }
}

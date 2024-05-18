import { Logger } from '../platform/logger.js';
import { HttpClient } from '../platform/http_client.js';
import { SalesforceAuthConfig, SalesforceAuthParams } from './connector_configs.js';
import { QueryExecutionResponseStream } from './query_execution.js';
import { executeQuery as execQuery } from './salesforce_query_execution.js';

export interface SalesforceCoreAccessToken {
    /// The OAuth token
    accessToken: string;
    /// A URL indicating the instance of the user’s org
    instanceUrl: string;
    /// The instance url
    apiInstanceUrl: string | null;
    /// An identity URL that can be used to identify the user and to query
    id: string | null;
    /// A signed data structure that contains authenticated user attributes
    idToken: string | null;
    /// Time stamp of when the signature was created in milliseconds
    issuedAt: string | null;
    /// Token obtained from the web server, user-agent, or hybrid app token flow
    refreshToken: string | null;
    /// The scopes associated with the access token.
    scope: string | null;
    /// Base64-encoded HMAC-SHA256 signature
    signature: string | null;
    /// A Bearer token type
    tokenType: string | null;
}

export interface SalesforceDataCloudAccessToken {
    /// The access token
    accessToken: string;
    /// The instance URL
    instanceUrl: URL;
    /// The expiration time
    expiresAt: Date;
    /// The issued token type
    issuedTokenType: string;
    /// The token type
    tokenType: string;
}

export interface SalesforceUserInfoPhotos {
    picture: string | null;
    thumbnail: string | null;
}

export interface SalesforceUserInfo {
    active: boolean | null;
    email: string | null;
    emailVerified: boolean | null;
    familyName: string | null;
    givenName: string | null;
    isAppInstalled: boolean | null;
    isSalesforceIntegrationUser: boolean | null;
    language: string | null;
    locale: string | null;
    name: string | null;
    nickname: string | null;
    organizationId: string | null;
    photos: SalesforceUserInfoPhotos | null;
    picture: string | null;
    preferredUsername: string | null;
    profile: string | null;
    sub: string | null;
    updatedAt: string | null;
    userId: string | null;
    userType: string | null;
    utcOffset: number | null;
    zoneinfo: string | null;
}

export interface SalesforceMetadataEntityField {
    name: string;
    displayName: string;
    type: string;
    businessType: string;
}

export interface SalesforceMetadataPrimaryKey {
    indexOrder: string;
    name: string;
    displayName: string;
}

export interface SalesforceMetadataEntity {
    name: string;
    displayName: string;
    category: string;
    fields: SalesforceMetadataEntityField[];
    primaryKeys: SalesforceMetadataPrimaryKey[];
}

export interface SalesforceMetadata {
    metadata: SalesforceMetadataEntity[];
}

export function readCoreAccessToken(obj: any): SalesforceCoreAccessToken {
    return {
        accessToken: obj.access_token ?? null,
        apiInstanceUrl: obj.api_instance_url ?? null,
        id: obj.id ?? null,
        idToken: obj.id_token ?? null,
        instanceUrl: obj.instance_url ?? null,
        issuedAt: obj.issued_at ?? null,
        refreshToken: obj.refresh_token ?? null,
        scope: obj.scope ?? null,
        signature: obj.signature ?? null,
        tokenType: obj.token_type ?? null,
    };
}

export function readDataCloudAccessToken(obj: any): SalesforceDataCloudAccessToken {
    const expiration = new Date();
    if (obj.expires_in) {
        expiration.setSeconds(expiration.getSeconds() + obj.expires_in);
    }
    const prependProtoIfMissing = (urlString: string) => {
        if (!urlString.startsWith('https:')) {
            urlString = `https://${urlString}`;
        }
        console.log(urlString);
        return new URL(urlString);
    };
    if (!obj.access_token) {
        throw new Error('missing expires_in');
    }
    if (!obj.expires_in) {
        throw new Error('missing expires_in');
    }
    if (!obj.instance_url) {
        throw new Error('missing instance_url');
    }
    return {
        accessToken: obj.access_token,
        instanceUrl: prependProtoIfMissing(obj.instance_url),
        expiresAt: obj.expires_in,
        issuedTokenType: obj.issued_token_type ?? null,
        tokenType: obj.token_type ?? null,
    };
}

export function readUserInformation(obj: any): SalesforceUserInfo {
    return {
        active: obj.active ?? null,
        email: obj.email ?? null,
        emailVerified: obj.email_verified ?? null,
        familyName: obj.family_name ?? null,
        givenName: obj.given_name ?? null,
        isAppInstalled: obj.is_app_installed ?? null,
        isSalesforceIntegrationUser: obj.is_salesforce_integration_user ?? null,
        language: obj.language ?? null,
        locale: obj.locale ?? null,
        name: obj.name ?? null,
        nickname: obj.nickname ?? null,
        organizationId: obj.organization_id ?? null,
        photos: obj.photos ?? null,
        picture: obj.picture ?? null,
        preferredUsername: obj.preferred_username ?? null,
        profile: obj.profile ?? null,
        sub: obj.sub ?? null,
        updatedAt: obj.updated_at ?? null,
        userId: obj.user_id ?? null,
        userType: obj.user_type ?? null,
        utcOffset: obj.utcOffset ?? null,
        zoneinfo: obj.zoneinfo ?? null,
    };
}

export interface SalesforceAPIClientInterface {
    getCoreAccessToken(
        authConfig: SalesforceAuthConfig,
        authParams: SalesforceAuthParams,
        authCode: string,
        pkceVerifier: string,
        cancel: AbortSignal,
    ): Promise<SalesforceCoreAccessToken>;
    getCoreUserInfo(access: SalesforceCoreAccessToken, cancel: AbortSignal): Promise<SalesforceUserInfo>;
    getDataCloudAccessToken(
        access: SalesforceCoreAccessToken,
        cancel: AbortSignal,
    ): Promise<SalesforceDataCloudAccessToken>;
    getDataCloudMetadata(access: SalesforceDataCloudAccessToken, cancel: AbortSignal): Promise<SalesforceMetadata>;
    executeQuery(scriptText: string, accessToken: SalesforceDataCloudAccessToken): QueryExecutionResponseStream;
}

export class SalesforceAPIClient implements SalesforceAPIClientInterface {
    logger: Logger;
    httpClient: HttpClient;

    constructor(logger: Logger, httpClient: HttpClient) {
        this.logger = logger;
        this.httpClient = httpClient;
    }

    public async getCoreAccessToken(
        authConfig: SalesforceAuthConfig,
        authParams: SalesforceAuthParams,
        authCode: string,
        pkceVerifier: string,
        cancel: AbortSignal,
    ): Promise<SalesforceCoreAccessToken> {
        const params: Record<string, string> = {
            grant_type: 'authorization_code',
            code: authCode!,
            redirect_uri: authConfig.oauthRedirect.toString(),
            client_id: authParams.appConsumerKey,
            code_verifier: pkceVerifier,
            format: 'json',
        };
        if (authParams.appConsumerSecret && authParams.appConsumerSecret !== null) {
            params.client_secret = authParams.appConsumerSecret;
        }
        const body = new URLSearchParams(params);
        // Get the access token
        const response = await this.httpClient.fetch(new URL(`${authParams.instanceUrl}/services/oauth2/token`), {
            method: 'POST',
            headers: new Headers({
                Accept: 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded',
            }),
            body: body,
            signal: cancel,
        });
        const responseBody = await response.json();
        console.log(responseBody);
        if (responseBody.error) {
            const errorDesc = responseBody.error_description;
            this.logger.error(errorDesc, "salesforce_api");
            throw new Error(errorDesc);
        } else {
            const parsed = readCoreAccessToken(responseBody);
            console.log(parsed);
            return parsed;
        }
    }

    public async getDataCloudAccessToken(
        access: SalesforceCoreAccessToken,
        cancel: AbortSignal,
    ): Promise<SalesforceDataCloudAccessToken> {
        console.log(access);
        const params: Record<string, string> = {
            grant_type: 'urn:salesforce:grant-type:external:cdp',
            subject_token: access.accessToken!,
            subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        };
        const body = new URLSearchParams(params);
        // Get the data cloud access token
        const response = await this.httpClient.fetch(new URL(`${access.instanceUrl}/services/a360/token`), {
            method: 'POST',
            headers: new Headers({
                Accept: 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded',
            }),
            body: body,
            signal: cancel,
        });
        const responseBody = await response.json();
        if (responseBody.error) {
            const err = responseBody as { error: string, error_description: string };
            throw new Error(`request failed: error=${err.error}, description=${err.error_description}`);
        }
        return readDataCloudAccessToken(responseBody);
    }

    public async getCoreUserInfo(access: SalesforceCoreAccessToken, cancel: AbortSignal): Promise<SalesforceUserInfo> {
        const params = new URLSearchParams();
        params.set('format', 'json');
        params.set('access_token', access.accessToken ?? '');
        const response = await this.httpClient.fetch(new URL(`${access.instanceUrl}/services/oauth2/userinfo?${params.toString()}`), {
            headers: {
                authorization: `Bearer ${access.accessToken}`,
            },
            signal: cancel,
        });
        const responseJson = await response.json();
        const responseInfo = readUserInformation(responseJson);
        return responseInfo;
    }

    public async getDataCloudMetadata(
        access: SalesforceDataCloudAccessToken,
        cancel: AbortSignal,
    ): Promise<SalesforceMetadata> {
        const params = new URLSearchParams();
        console.log(access.instanceUrl);
        const response = await this.httpClient.fetch(`${access.instanceUrl}api/v1/metadata?${params.toString()}`, {
            headers: {
                authorization: `Bearer ${access.accessToken}`,
            },
            signal: cancel,
        });
        const responseJson = await response.json();
        return responseJson as SalesforceMetadata;
    }
    public executeQuery(scriptText: string, accessToken: SalesforceDataCloudAccessToken): QueryExecutionResponseStream {
        return execQuery(scriptText, accessToken);
    }
}

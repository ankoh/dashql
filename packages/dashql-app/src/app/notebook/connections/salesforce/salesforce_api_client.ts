import * as connection from '@ankoh/dashql-jsonschema/connection.js';
import * as pb from "../../../../proto.js";

import { Logger } from '../../../../platform/logger/logger.js';
import { HttpClient } from '../../../../platform/http/http_client.js';
import { HyperDatabaseChannel, HyperQueryResultStream } from '../hyper/hyperdb_grpc_client.js';
import { BASE64URL_CODEC } from "../../../../utils/base64.js";
import { dateToTimestamp } from "../proto_helper.js";

const LOG_CTX = "salesforce_api";
const SALESFORCE_API_VERSION = "v64.0";
export const DEFAULT_SALESFORCE_DATA_SPACE = "default";
export const SALESFORCE_METADATA_ENTITY_TYPES = ['DataModelObject', 'DataLakeObject', 'CalculatedInsight'] as const;

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
    /// The dataspace
    dataspace: string;
}

export interface SalesforceMetadataProgress {
    collection: string;
    page: number;
    loaded: number;
    total: number | null;
    state: 'requesting' | 'complete' | 'failed';
    error?: string;
}

export function formatSalesforceMetadataProgress(
    progressByCollection: ReadonlyMap<string, SalesforceMetadataProgress>,
): string {
    const labels: Record<string, string> = {
        DataModelObject: 'DMO',
        DataLakeObject: 'DLO',
        CalculatedInsight: 'CI',
    };
    let completed = 0;
    let running = 0;
    let failed = 0;
    let pending = 0;
    const stages = SALESFORCE_METADATA_ENTITY_TYPES.map(collection => {
        const progress = progressByCollection.get(collection);
        if (progress?.state === 'complete') {
            completed += 1;
            return `${labels[collection]} ${progress.loaded}`;
        }
        if (progress?.state === 'failed') {
            failed += 1;
            return `${labels[collection]} failed`;
        }
        if (progress?.state === 'requesting') {
            running += 1;
            return `${labels[collection]} -`;
        }
        pending += 1;
        return `${labels[collection]} -`;
    });
    const counts = [`${completed} done`, `${running} active`, `${failed} failed`];
    if (pending > 0) counts.push(`${pending} pending`);
    return `Metadata: ${counts.join(', ')} | ${stages.join(' | ')}`;
}

export function getSalesforceDataSpace(access: connection.SalesforceDataCloudAccessToken): string {
    const customAttributes = access.jwt?.payload?.customAttributes as unknown;
    if (customAttributes && typeof customAttributes === "object") {
        const attributes = customAttributes as Record<string, unknown>;
        const nested = attributes.data;
        const dataSpace = nested && typeof nested === "object"
            ? (nested as Record<string, unknown>).dataspace
            : attributes.dataspace;
        if (typeof dataSpace === "string" && dataSpace.length > 0) {
            return dataSpace;
        }
    }
    return DEFAULT_SALESFORCE_DATA_SPACE;
}

export function getSalesforceLakehousePath(tenantId: string | null | undefined, dataSpace: string): string {
    return `lakehouse:${tenantId ?? ""};${dataSpace}`;
}

/// Read the Salesforce auth tokens
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
            dataspace: getSalesforceDataSpace(offcoreToken),
        };
    } else {
        return null;
    }
}

export function parseCoreAccessToken(obj: any): connection.SalesforceCoreAccessToken {
    return {
        createdAt: new Date().toISOString(),
        accessToken: obj.access_token,
        apiInstanceUrl: obj.api_instance_url,
        id: obj.id,
        idToken: obj.id_token,
        instanceUrl: obj.instance_url,
        issuedAt: obj.issued_at,
        refreshToken: obj.refresh_token,
        scope: obj.scope,
        signature: obj.signature,
        tokenType: obj.token_type,
    };
}

export function parseCoreUserInfo(obj: any): connection.SalesforceCoreUserInfo {
    return ({
        active: obj.active,
        email: obj.email,
        emailVerified: obj.email_verified,
        familyName: obj.family_name,
        givenName: obj.given_name,
        isAppInstalled: obj.is_app_installed,
        isSalesforceIntegrationUser: obj.is_salesforce_integration_user,
        language: obj.language,
        locale: obj.locale,
        name: obj.name,
        nickname: obj.nickname,
        organizationId: obj.organization_id,
        photos: obj.photos,
        picture: obj.picture,
        preferredUsername: obj.preferred_username,
        profile: obj.profile,
        sub: obj.sub,
        updatedAt: obj.updated_at,
        userId: obj.user_id,
        userType: obj.user_type,
        utcOffset: obj.utcOffset,
        zoneinfo: obj.zoneinfo,
    });
}

function parseDataCloudJWTPayload(obj: any): connection.SalesforceDataCloudJWTPayload {
    if (typeof obj !== "object") {
        return {
            sub: "",
            aud: "",
            exp: "",
            iat: "",
            jti: "",
            scp: "",
            iss: "",
            nbf: "",
            orgId: "",
            sfappid: "",
            sfoid: "",
            sfuid: "",
            issuerTenantId: "",
            audienceTenantId: "",
        };
    }
    // XXX This is likely insufficiently relaxed.
    // Also: Log if something unexpected comes up.
    return {
        sub: obj.sub,
        aud: obj.aud,
        exp: obj.exp,
        iat: obj.iat,
        jti: obj.jti,
        scp: obj.scp,
        iss: obj.iss,
        nbf: obj.nbf,
        orgId: obj.orgId,
        sfappid: obj.sfappid,
        sfoid: obj.sfoid,
        sfuid: obj.sfuid,
        issuerTenantId: obj.issuerTenantId,
        audienceTenantId: obj.audienceTenantId,
        customAttributes: obj.customAttributes ?? obj.custom_attributes,
    };
}

export interface SalesforceApiClientInterface {
    getCoreAccessToken(
        authConfig: connection.SalesforceOAuthConfig,
        authParams: connection.SalesforceConnectionParams,
        authCode: string,
        pkceVerifier: string,
        cancel: AbortSignal,
    ): Promise<connection.SalesforceCoreAccessToken>;
    getCoreUserInfo(
        access: connection.SalesforceCoreAccessToken,
        cancel: AbortSignal,
    ): Promise<connection.SalesforceCoreUserInfo>;
    getDataCloudAccessToken(
        access: connection.SalesforceCoreAccessToken,
        cancel: AbortSignal,
    ): Promise<connection.SalesforceDataCloudAccessToken>;
    getDataCloudMetadata(
        access: connection.SalesforceCoreAccessToken,
        dataSpace: string,
        cancel: AbortSignal,
        onProgress?: (progress: SalesforceMetadataProgress) => void,
    ): Promise<connection.SalesforceDataCloudMetadata>;
}

export class SalesforceApiClient implements SalesforceApiClientInterface {
    logger: Logger;
    httpClient: HttpClient;
    textDecoder: TextDecoder;

    constructor(logger: Logger, httpClient: HttpClient) {
        this.logger = logger;
        this.httpClient = httpClient;
        this.textDecoder = new TextDecoder();
    }

    public async getCoreAccessToken(
        authConfig: connection.SalesforceOAuthConfig,
        authParams: connection.SalesforceConnectionParams,
        authCode: string,
        pkceVerifier: string,
        cancel: AbortSignal,
    ): Promise<connection.SalesforceCoreAccessToken> {
        const params: Record<string, string> = {
            grant_type: 'authorization_code',
            code: authCode!,
            redirect_uri: authConfig.oauthRedirect.toString(),
            client_id: authParams.appConsumerKey,
            code_verifier: pkceVerifier,
            format: 'json',
        };
        if (authParams.appConsumerSecret) {
            params.client_secret = authParams.appConsumerSecret;
        }
        const body = new URLSearchParams(params);
        // Get the access token
        const headers = new Headers({
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
        });
        const url = new URL(`${authParams.instanceUrl}/services/oauth2/token`);
        const response = await this.httpClient.fetch(url, {
            method: 'POST',
            headers,
            body: body,
            signal: cancel,
        });
        const responseBody = await response.json();
        if (responseBody.error) {
            const errorDesc = responseBody.error_description;
            this.logger.warn(errorDesc, {}, LOG_CTX);
            throw new Error(errorDesc);
        } else {
            const parsed = parseCoreAccessToken(responseBody);
            return parsed;
        }
    }

    protected readDataCloudAccessToken(obj: any): connection.SalesforceDataCloudAccessToken {
        const prependURLSchemaIfMissing = (urlString: string) => {
            if (!urlString.startsWith('https:')) {
                urlString = `https://${urlString}`;
            }
            return new URL(urlString);
        };
        if (!obj.access_token) {
            throw new Error('missing access_token');
        }
        if (!obj.instance_url) {
            throw new Error('missing instance_url');
        }

        const access_token = obj.access_token;
        const jwtParts = access_token.split('.');
        if (jwtParts.length != 3) {
            throw new Error(`invalid jwt, expected 3 parts, received ${jwtParts.length}`);
        }

        // Parse the JWT header
        const jwtHeaderRaw = jwtParts[0];
        const jwtHeaderBytes = BASE64URL_CODEC.decode(jwtHeaderRaw);
        const jwtHeaderText = this.textDecoder.decode(jwtHeaderBytes);
        const jwtHeaderParsed = JSON.parse(jwtHeaderText);

        // Parse the JWT payload
        const jwtPayloadRaw = jwtParts[1];
        const jwtPayloadBytes = BASE64URL_CODEC.decode(jwtPayloadRaw);
        const jwtPayloadText = this.textDecoder.decode(jwtPayloadBytes);
        const jwtPayloadParsed = parseDataCloudJWTPayload(JSON.parse(jwtPayloadText));

        const accessTokenExpiresAt = new Date(Number.parseInt(jwtPayloadParsed.exp) * 1000);
        const accessToken: connection.SalesforceDataCloudAccessToken = {
            createdAt: new Date().toISOString(),
            tokenType: obj.token_type,
            issuedTokenType: obj.issued_token_type,
            expiresAt: dateToTimestamp(accessTokenExpiresAt)!,
            jwt: {
                raw: access_token,
                header: jwtHeaderParsed,
                payload: jwtPayloadParsed
            },
            instanceUrl: prependURLSchemaIfMissing(obj.instance_url).toString(),
        };
        return accessToken;
    }

    public async getDataCloudAccessToken(
        access: connection.SalesforceCoreAccessToken,
        cancel: AbortSignal,
    ): Promise<connection.SalesforceDataCloudAccessToken> {
        const params: Record<string, string> = {
            grant_type: 'urn:salesforce:grant-type:external:cdp',
            subject_token: access.accessToken!,
            subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
            // dataspace: 'default'
        };
        const body = new URLSearchParams(params);
        // Get the data cloud access token
        const headers = new Headers({
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
        });
        const url = new URL(`${access.instanceUrl ?? ""}/services/a360/token`);
        const response = await this.httpClient.fetch(url, {
            method: 'POST',
            headers,
            body: body,
            signal: cancel,
        });
        const responseBody = await response.json();
        if (responseBody.error) {
            const err = responseBody as { error: string, error_description: string };
            throw new Error(`request failed: error=${err.error}, description=${err.error_description}`);
        }
        return this.readDataCloudAccessToken(responseBody);
    }

    public async getCoreUserInfo(
        access: connection.SalesforceCoreAccessToken,
        cancel: AbortSignal,
    ): Promise<connection.SalesforceCoreUserInfo> {
        const params = new URLSearchParams();
        params.set('format', 'json');
        params.set('access_token', access.accessToken ?? '');
        const headers = new Headers({
            authorization: `Bearer ${access.accessToken}`,
            accept: 'application/json',
        });
        const url = new URL(`${access.instanceUrl ?? ""}/services/oauth2/userinfo?${params.toString()}`);
        const response = await this.httpClient.fetch(url, {
            headers,
            signal: cancel,
        });
        const responseJson = await response.json();
        return parseCoreUserInfo(responseJson);
    }

    public async getDataCloudMetadata(
        access: connection.SalesforceCoreAccessToken,
        dataSpace: string,
        cancel: AbortSignal,
        onProgress: (progress: SalesforceMetadataProgress) => void = () => { },
    ): Promise<connection.SalesforceDataCloudMetadata> {
        const base = (access.instanceUrl ?? "").replace(/\/+$/, '');
        const headers = new Headers({
            authorization: `Bearer ${access.accessToken}`,
            accept: 'application/json',
        });
        const endpoint = `${base}/services/data/${SALESFORCE_API_VERSION}/ssot/metadata`;
        this.logger.info("Requesting Salesforce metadata", {
            method: "GET",
            endpoint,
            apiVersion: SALESFORCE_API_VERSION,
            dataSpace,
            entityTypes: SALESFORCE_METADATA_ENTITY_TYPES.join(','),
        }, LOG_CTX);
        const requestStartedAt = performance.now();
        const requestResults = await Promise.allSettled(SALESFORCE_METADATA_ENTITY_TYPES.map(async entityType => {
            const url = new URL(endpoint);
            url.searchParams.set('dataspace', dataSpace);
            url.searchParams.set('entityType', entityType);
            onProgress({ collection: entityType, page: 1, loaded: 0, total: null, state: 'requesting' });
            try {
                const response = await this.httpClient.fetch(url, {
                    headers,
                    signal: cancel,
                });
                if (response.status < 200 || response.status >= 300) {
                    const bodyText = await response.text().catch(() => '');
                    throw new Error(`${response.status} ${response.statusText}${bodyText ? ` — ${bodyText.slice(0, 200)}` : ''}`);
                }
                const body = await response.json();
                const entities = Array.isArray(body.metadata) ? body.metadata : [];
                onProgress({
                    collection: entityType,
                    page: 1,
                    loaded: entities.length,
                    total: entities.length,
                    state: 'complete',
                });
                return entities;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                this.logger.warn('Salesforce metadata request failed', {
                    dataSpace,
                    entityType,
                    error: message,
                }, LOG_CTX);
                onProgress({
                    collection: entityType,
                    page: 1,
                    loaded: 0,
                    total: null,
                    state: 'failed',
                    error: message,
                });
                throw new Error(`Salesforce ${entityType} metadata request failed: ${message}`);
            }
        }));
        const progressByCollection = new Map<string, SalesforceMetadataProgress>();
        const responseEntities: any[][] = [];
        let failedRequests = 0;
        requestResults.forEach((result, index) => {
            const collection = SALESFORCE_METADATA_ENTITY_TYPES[index];
            if (result.status === 'fulfilled') {
                responseEntities.push(result.value);
                progressByCollection.set(collection, {
                    collection,
                    page: 1,
                    loaded: result.value.length,
                    total: result.value.length,
                    state: 'complete',
                });
            } else {
                const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
                failedRequests += 1;
                progressByCollection.set(collection, {
                    collection,
                    page: 1,
                    loaded: 0,
                    total: null,
                    state: 'failed',
                    error: message,
                });
            }
        });
        if (failedRequests === SALESFORCE_METADATA_ENTITY_TYPES.length) {
            throw new Error(formatSalesforceMetadataProgress(progressByCollection));
        }
        this.logger.info("Received Salesforce metadata response", {
            durationMs: (performance.now() - requestStartedAt).toFixed(2),
            dataSpace,
            failedRequests: failedRequests.toString(),
        }, LOG_CTX);

        // Parse the Data Cloud metadata
        const entities: connection.SalesforceDataCloudMetadataEntity[] = [];
        let fieldCount = 0;
        for (const collectionEntities of responseEntities) {
            for (const entityJson of collectionEntities) {
                const rawFields = entityJson.fields ?? [];
                const fields: connection.SalesforceDataCloudMetadataEntityField[] = [];
                if (Array.isArray(rawFields)) {
                    for (const fieldJson of rawFields) {
                        fields.push(({
                            name: fieldJson.name ?? '',
                            displayName: fieldJson.displayName ?? '',
                            type: fieldJson.type ?? '',
                            businessType: fieldJson.businessType ?? '',
                        }));
                        fieldCount += 1;
                    }
                }
                const primaryKeys: connection.SalesforceDataCloudMetadataPrimaryKey[] = [];
                if (entityJson.primaryKeys && Array.isArray(entityJson.primaryKeys)) {
                    for (const pkJson of entityJson.primaryKeys) {
                        primaryKeys.push(({
                            indexOrder: pkJson.indexOrder ?? '',
                            name: pkJson.name ?? '',
                            displayName: pkJson.displayName ?? '',
                        }));
                    }
                }
                entities.push(({
                    name: entityJson.name ?? '',
                    displayName: entityJson.displayName ?? '',
                    category: entityJson.category ?? '',
                    fields: fields,
                    primaryKeys: primaryKeys,
                }));
            }
        }
        this.logger.info("Parsed Salesforce metadata", {
            dataSpace,
            entities: entities.length.toString(),
            fields: fieldCount.toString(),
        }, LOG_CTX);
        return ({
            metadata: entities
        });
    }
}

export class SalesforceDatabaseChannel implements HyperDatabaseChannel {
    /// The api client
    protected apiClient: SalesforceApiClientInterface;
    /// The core access token
    public readonly coreToken: connection.SalesforceCoreAccessToken;
    /// The data cloud access token
    public readonly dataCloudToken: connection.SalesforceDataCloudAccessToken;
    /// The Hyper database channel
    hyperChannel: HyperDatabaseChannel;

    /// The constructor
    constructor(apiClient: SalesforceApiClientInterface, coreToken: connection.SalesforceCoreAccessToken, dataCloudToken: connection.SalesforceDataCloudAccessToken, channel: HyperDatabaseChannel) {
        this.apiClient = apiClient;
        this.coreToken = coreToken;
        this.dataCloudToken = dataCloudToken;
        this.hyperChannel = channel;
    }

    /// Execute Query
    async executeQuery(param: pb.salesforce_hyperdb_grpc_v1.pb.QueryParam, abort?: AbortSignal): Promise<HyperQueryResultStream> {
        return this.hyperChannel.executeQuery(param, abort);
    }
    /// Destroy the connection
    async close(): Promise<void> {
        return this.hyperChannel.close();
    }
}

import * as connection from '@ankoh/dashql-jsonschema/connection.js';
import * as pb from "../../proto.js";

import { HyperDatabaseChannel, HyperHttpChannelDescription, HyperQueryExecutionOptions, HyperQueryResultStream } from '../hyper/hyperdb_grpc_client.js';

// The setup, the token exchange and the metadata of Salesforce are the runtime's (`salesforce/` of the runtime crate),
// the platform keeps the channel with the tokens and what the login of the shell shows of them.

export const DEFAULT_SALESFORCE_DATA_SPACE = "default";

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

export class SalesforceDatabaseChannel implements HyperDatabaseChannel {
    /// The core access token
    public readonly coreToken: connection.SalesforceCoreAccessToken;
    public readonly dataCloudToken: connection.SalesforceDataCloudAccessToken;
    /// The Hyper database channel
    hyperChannel: HyperDatabaseChannel;

    /// The constructor
    constructor(coreToken: connection.SalesforceCoreAccessToken, dataCloudToken: connection.SalesforceDataCloudAccessToken, channel: HyperDatabaseChannel) {
        this.coreToken = coreToken;
        this.dataCloudToken = dataCloudToken;
        this.hyperChannel = channel;
    }

    /// Execute Query
    async executeQuery(param: pb.salesforce_hyperdb_grpc_v1.pb.QueryParam, abort?: AbortSignal, options?: HyperQueryExecutionOptions): Promise<HyperQueryResultStream> {
        return this.hyperChannel.executeQuery(param, abort, options);
    }
    /// The Hyper channel over the HTTP API with the bearer token of Data Cloud, null for another channel
    async describeHttp(): Promise<HyperHttpChannelDescription | null> {
        return await this.hyperChannel.describeHttp?.() ?? null;
    }
    /// Destroy the connection
    async close(): Promise<void> {
        return this.hyperChannel.close();
    }
}

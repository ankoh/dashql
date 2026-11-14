import * as connection from '@ankoh/dashql-jsonschema/connection.js';
import * as auth from '@ankoh/dashql-jsonschema/auth.js';

import { HttpClient, HttpFetchResult } from "../../platform/http/http_client.js";
import { LoggableException, Logger } from "../../platform/logger/logger.js";
import { dateToTimestamp } from '../proto_helper.js';
import type { TrinoSessionDefaults } from './trino_catalogs.js';

const LOG_CTX = "trino_api";

export class TrinoApiEndpoint {
    // The endpoint url
    endpoint: string;
    // The auth params
    authParams: auth.TrinoAuthParams;
    // The auth state
    oauthState: connection.TrinoOAuthState | null;
    // The pending access token refresh
    oauthRefresh: Promise<void> | null;

    constructor(endpoint: string, params: auth.TrinoAuthParams) {
        this.endpoint = endpoint;
        this.authParams = params;
        this.oauthState = null;
        this.oauthRefresh = null;
    }
}

/// Request an access token from an OAuth token endpoint
export async function requestTrinoAccessToken(httpClient: HttpClient, tokenUrl: string, body: URLSearchParams): Promise<connection.TrinoAccessToken> {
    const response = await httpClient.fetch(new URL(tokenUrl), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
    });
    if (response.status < 200 || response.status >= 300) {
        const errorText = await response.text();
        throw new Error(`Token request failed: ${response.status} ${errorText}`);
    }
    const tokenData = await response.json();
    const expiresAt = tokenData.expires_in
        ? new Date(Date.now() + (tokenData.expires_in * 1000))
        : null;
    return {
        createdAt: dateToTimestamp(new Date())!,
        accessToken: tokenData.access_token,
        tokenType: tokenData.token_type || 'Bearer',
        refreshToken: tokenData.refresh_token,
        expiresAt: dateToTimestamp(expiresAt),
        scope: tokenData.scope,
    };
}

/// Refresh access tokens a minute before they expire
const ACCESS_TOKEN_REFRESH_MARGIN_MS = 60 * 1000;

/// The size of the result pages that we ask Trino for.
/// Trino returns pages of 1 MB by default and caps the size at 128 MB.
/// A page also ends early when the coordinator has no more rows buffered, its exchange buffer holds 32 MB by default.
export const TARGET_RESULT_SIZE = "32MB";

export interface TrinoQueryFailureInfo {
    /// The failure type
    type: string;
    /// The failure message
    message: string;
    /// The suppressed error
    suppressed: string[];
    /// The error stack
    stack: string[];
};

export interface TrinoQueryError {
    /// The erro message
    message: string;
    /// The error code
    errorCode: number;
    /// The error name
    errorName: string;
    /// The error type
    errorType: string;
    /// The failure info
    failureInfo: TrinoQueryFailureInfo;
};

export interface TrinoQueryResultColumn {
    /// The column name
    name: string;
    /// The column type
    type: string
};

export type TrinoQueryData = any[];

export interface TrinoQueryStage {
    /// The trino stage id
    stageId: string;
    /// The state
    state: string;
    /// Is the query done?
    done: boolean;
    /// The number of nodes in the stage
    nodes: number;
    /// The total number of splits
    totalSplits: number;
    /// The number of queued splits
    queuedSplits: number;
    /// The splits that are currently running
    runningSplits: number;
    /// The splits that are completed
    completedSplits: number;
    /// The cpu time in milliseconds
    cpuTimeMillis: number;
    /// The wall time in milliseconds
    wallTimeMillis: number;
    /// The processed rows
    processedRows: number;
    /// The processed bytes
    processedBytes: number;
    /// The physical input bytes
    physicalInputBytes: number;
    /// The number of failed tasks
    failedTasks: number;
    /// Coordinator-only query?
    coordinatorOnly: boolean;
    /// The number of substages
    subStages: TrinoQueryStage[];
};

export interface TrinoQueryStatistics {
    /// The state
    state: string;
    /// Is the query queued?
    queued: boolean;
    /// Is the query scheduled?
    scheduled: boolean;
    /// The number of nodes
    nodes: number;
    /// The total number of splits
    totalSplits: number;
    /// The queued number of splits
    queuedSplits: number;
    /// The currently running splits
    runningSplits: number;
    /// The number of completed splits
    completedSplits: number;
    /// The CPU time in milliseconds
    cpuTimeMillis: number;
    /// The wallclock time in milliseconds
    wallTimeMillis: number;
    /// The time that the query was queued
    queuedTimeMillis: number;
    /// The elapsed time
    elapsedTimeMillis: number;
    /// The number of processed rows
    processedRows: number;
    /// The number of processed bytes
    processedBytes: number;
    /// The number of input bytes
    physicalInputBytes: number;
    /// The peak memory size
    peakMemoryBytes: number;
    /// The number of spilled bytes
    spilledBytes: number;
    /// The root stage
    rootStage: TrinoQueryStage;
    /// The progess percentage
    progressPercentage: number;
};

export interface TrinoQueryResult {
    /// The query id
    id: string;
    /// The URI for the query info call
    infoUri?: string;
    /// The URI for fetching the next query batch
    nextUri?: string;
    /// The result columns
    columns?: TrinoQueryResultColumn[];
    /// The query data
    data?: TrinoQueryData[];
    /// The query statistics
    stats?: TrinoQueryStatistics;
    /// The warnings during the query execution
    warnings?: string[];
    /// The query error (if any)
    error?: TrinoQueryError;
};

export interface TrinoQueryInfo {
    /// The query id
    queryId: string;
    /// The query state
    state: string;
    /// The query text
    query: string;
    /// The failure info
    failureInfo?: TrinoQueryFailureInfo;
    /// Did Trino collect the final infos of all tasks?
    finalQueryInfo?: boolean;
    /// The stages, a flat list
    stages?: { stages?: TrinoStageInfo[] };
};

/// A stage of a QueryInfo, the progress model reads the rest
export interface TrinoStageInfo {
    /// The stage id, `<queryId>.<fragmentId>`
    stageId: string;
    /// The stage state
    state: string;
    /// The statistics, with the operator summaries once the tasks of the stage are done
    stageStats?: { operatorSummaries?: object[] };
}

export interface TrinoApiClientInterface {
    /// Run a query
    runQuery(endpoint: TrinoApiEndpoint, defaults: TrinoSessionDefaults, text: string, abort?: AbortSignal): Promise<TrinoQueryResult>;
    /// Get a query result
    getQueryResult(endpoint: TrinoApiEndpoint, nextUri: string, abort?: AbortSignal): Promise<TrinoQueryResult>;
    /// Get the QueryInfo of a query: the stages with their plans and statistics
    getQueryInfo(endpoint: TrinoApiEndpoint, queryId: string, abort?: AbortSignal): Promise<TrinoQueryInfo>;
    /// Cancel a query by its next URI
    cancelQuery(endpoint: TrinoApiEndpoint, nextUri: string): Promise<void>;
}


export class TrinoApiClient implements TrinoApiClientInterface {
    /// The logger
    logger: Logger;
    /// The http client
    httpClient: HttpClient;
    /// The retries of failed requests of query results
    retryPolicy: TrinoRetryPolicy;

    constructor(logger: Logger, httpClient: HttpClient, retryPolicy: TrinoRetryPolicy = DEFAULT_TRINO_RETRY_POLICY) {
        this.logger = logger;
        this.httpClient = httpClient;
        this.retryPolicy = retryPolicy;
    }

    /// Refresh the OAuth access token if it is about to expire
    async refreshAccessToken(endpoint: TrinoApiEndpoint): Promise<void> {
        const oauth = endpoint.authParams.oauth;
        const token = endpoint.oauthState?.accessToken;
        if (endpoint.authParams.authType != "AUTH_OAUTH" || !oauth || !token?.refreshToken || !token.expiresAt) {
            return;
        }
        if (new Date(token.expiresAt).getTime() - Date.now() > ACCESS_TOKEN_REFRESH_MARGIN_MS) {
            return;
        }
        if (!endpoint.oauthRefresh) {
            this.logger.debug("Refreshing access token", {}, LOG_CTX);
            endpoint.oauthRefresh = requestTrinoAccessToken(this.httpClient, oauth.tokenUrl, new URLSearchParams({
                grant_type: 'refresh_token',
                client_id: oauth.clientId,
                refresh_token: token.refreshToken,
            })).then(refreshed => {
                endpoint.oauthState!.accessToken = { ...refreshed, refreshToken: refreshed.refreshToken ?? token.refreshToken };
            }).finally(() => {
                endpoint.oauthRefresh = null;
            });
        }
        await endpoint.oauthRefresh;
    }

    /// Build the request headers for an endpoint
    async getHeaders(endpoint: TrinoApiEndpoint): Promise<Headers> {
        await this.refreshAccessToken(endpoint);
        const headers = new Headers();
        addAuthHeaders(headers, endpoint);
        return headers;
    }

    /// Run a query
    async runQuery(endpoint: TrinoApiEndpoint, defaults: TrinoSessionDefaults, text: string, abort?: AbortSignal): Promise<TrinoQueryResult> {
        this.logger.debug("Running query", { "text": text }, LOG_CTX);
        const url = new URL(`${endpoint.endpoint}/v1/statement`);
        const headers = await this.getHeaders(endpoint);
        // Trino sees every catalog of the server, the defaults only resolve the names that statements leave out
        if (defaults.catalog != null) {
            headers.set('X-Trino-Catalog', defaults.catalog);
            if (defaults.schema != null) {
                headers.set('X-Trino-Schema', defaults.schema);
            }
        }
        const rawResponse = await this.httpClient.fetch(url, {
            method: 'POST',
            body: text,
            headers,
            signal: abort,
        });
        if (rawResponse.status != 200) {
            throw new LoggableException(`Query failed`, {
                status: rawResponse.status.toString(),
                message: rawResponse.statusText.toString()
            }, LOG_CTX);
        }
        const responseJson = await rawResponse.json() as TrinoQueryResult;
        const response = responseJson as TrinoQueryResult;
        return response;
    }

    /// Get the query result batch.
    /// Trino answers a repeated request of a next URI with the same page, so failed requests are retried.
    async getQueryResult(endpoint: TrinoApiEndpoint, nextUri: string, abort?: AbortSignal): Promise<TrinoQueryResult> {
        this.logger.debug("Getting query results", { "nextUri": nextUri }, LOG_CTX);
        const url = new URL(nextUri);
        // Only the URIs of executing queries return rows
        if (url.pathname.includes('/v1/statement/executing/')) {
            url.searchParams.set('targetResultSize', TARGET_RESULT_SIZE);
        }
        for (let attempt = 1; ; ++attempt) {
            const retriesLeft = attempt < this.retryPolicy.attempts;
            let rawResponse: HttpFetchResult;
            try {
                const headers = await this.getHeaders(endpoint);
                rawResponse = await this.httpClient.fetch(url, {
                    method: 'GET',
                    headers,
                    signal: abort,
                });
            } catch (e: any) {
                // Retry requests that failed in the network
                if (!retriesLeft || abort?.aborted) throw e;
                this.logger.warn("Retrying a failed request of query results", { "attempt": attempt.toString(), "error": String(e) }, LOG_CTX);
                await sleepUnlessAborted(retryDelayMs(this.retryPolicy, attempt), abort);
                continue;
            }
            if (rawResponse.status == 200) {
                return parseTrinoJson(await rawResponse.text()) as TrinoQueryResult;
            }
            // Retry responses of a busy or restarting coordinator or gateway
            if (retriesLeft && RETRIED_STATUS_CODES.has(rawResponse.status)) {
                this.logger.warn("Retrying a rejected request of query results", { "attempt": attempt.toString(), "status": rawResponse.status.toString() }, LOG_CTX);
                await sleepUnlessAborted(retryDelayMs(this.retryPolicy, attempt), abort);
                continue;
            }
            throw new LoggableException(`Failed to fetch query results`, {
                status: rawResponse.status.toString(),
                message: rawResponse.statusText.toString()
            }, LOG_CTX);
        }
    }

    /// Get a query info
    async getQueryInfo(endpoint: TrinoApiEndpoint, queryId: string, abort?: AbortSignal): Promise<TrinoQueryInfo> {
        this.logger.debug("Getting query info", { "query": queryId }, LOG_CTX);
        const url = new URL(`${endpoint.endpoint}/v1/query/${encodeURIComponent(queryId)}`);
        const headers = await this.getHeaders(endpoint);
        const rawResponse = await this.httpClient.fetch(url, {
            method: 'GET',
            headers,
            signal: abort,
        });
        if (rawResponse.status != 200) {
            throw new LoggableException(`Failed to fetch query info`, {
                status: rawResponse.status.toString(),
                message: rawResponse.statusText.toString()
            }, LOG_CTX);
        }
        const responseJson = await rawResponse.json() as TrinoQueryInfo;
        const response = responseJson as TrinoQueryInfo;
        return response;
    }

    /// Cancel a query by deleting its next URI, Trino answers with 204 No Content
    async cancelQuery(endpoint: TrinoApiEndpoint, nextUri: string): Promise<void> {
        this.logger.debug("Cancelling query", { "nextUri": nextUri }, LOG_CTX);
        const url = new URL(nextUri);
        const headers = await this.getHeaders(endpoint);
        const rawResponse = await this.httpClient.fetch(url, {
            method: 'DELETE',
            headers
        });
        if (rawResponse.status < 200 || rawResponse.status >= 300) {
            throw new LoggableException(`Cancelling a query failed`, {
                status: rawResponse.status.toString(),
                message: rawResponse.statusText.toString()
            }, LOG_CTX);
        }
    }
}

/// The status codes of requests that are retried: too many requests, bad gateway, service unavailable, gateway timeout
const RETRIED_STATUS_CODES = new Set([429, 502, 503, 504]);

/// The retries of failed requests of query results
export interface TrinoRetryPolicy {
    /// The number of attempts, including the first one
    attempts: number;
    /// The delay before the first retry, it doubles with every retry
    initialDelayMs: number;
    /// The maximum delay between retries
    maxDelayMs: number;
}

/// Retry for about 20 seconds before failing a query
export const DEFAULT_TRINO_RETRY_POLICY: TrinoRetryPolicy = {
    attempts: 10,
    initialDelayMs: 100,
    maxDelayMs: 3000,
};

/// The delay after the failed attempt
function retryDelayMs(policy: TrinoRetryPolicy, attempt: number): number {
    return Math.min(policy.initialDelayMs * 2 ** (attempt - 1), policy.maxDelayMs);
}

/// Sleep, an abort ends the sleep with the abort reason
async function sleepUnlessAborted(ms: number, abort?: AbortSignal): Promise<void> {
    abort?.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
            clearTimeout(timer);
            reject(abort!.reason);
        };
        const timer = setTimeout(() => {
            abort?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        abort?.addEventListener('abort', onAbort, { once: true });
    });
}

/// Integers with 16 or more digits may exceed the safe integers of JavaScript numbers
const LONG_INTEGER_PATTERN = /\d{16}/;
/// The source text of an integer
const INTEGER_TEXT_PATTERN = /^-?\d+$/;

/// Parse a JSON response of Trino.
/// Trino writes bigint values as JSON numbers, integers beyond the safe integers are parsed from their source text as BigInt.
/// Only texts with a long digit run pay for the reviver.
export function parseTrinoJson(text: string): any {
    if (!LONG_INTEGER_PATTERN.test(text)) {
        return JSON.parse(text);
    }
    return JSON.parse(text, (_key: string, value: any, context?: { source?: string }) => {
        if (typeof value === 'number' && !Number.isSafeInteger(value) && context?.source != null && INTEGER_TEXT_PATTERN.test(context.source)) {
            return BigInt(context.source);
        }
        return value;
    });
}

/// Helper to add auth headers based on auth type
function addAuthHeaders(headers: Headers, endpoint: TrinoApiEndpoint): void {
    const authParams = endpoint.authParams;
    const authType = authParams.authType ?? "AUTH_BASIC";
    switch (authType) {
        case "AUTH_OAUTH":
            // OAuth: Use Bearer token
            if (endpoint.oauthState?.accessToken?.accessToken) {
                headers.set('Authorization', `Bearer ${endpoint.oauthState?.accessToken?.accessToken}`);
            }
            // XXX X-Trino-User from user hint?
            break;

        case "AUTH_BASIC":
        default:
            // Basic auth: Use username:password
            if (authParams.basic?.username && authParams.basic.username.length > 0) {
                headers.set('Authorization', 'Basic ' + btoa(authParams.basic.username + ":" + (authParams.basic.secret ?? "")));
                headers.set('X-Trino-User', authParams.basic.username);
            }
            break;
    }
}

import { HttpClient, HttpFetchResult } from '../../platform/http/http_client.js';
import { Logger } from '../../platform/logger/logger.js';

const LOG_CTX = "hyperdb_http_client";

// ---------------------------------------------------------------------------
// Shared V3 API types
// ---------------------------------------------------------------------------

export type CompletionStatus =
    | "RUNNING_OR_UNSPECIFIED"
    | "FINISHED"
    | "RESULTS_PRODUCED";

export interface ColumnDefinition {
    name?: string;
    type?: string;
    nullable?: boolean;
}

export interface ExecutionStats {
    wallClockTime: number;
    rowsProcessed: number;
}

export interface QueryStatus {
    queryId: string;
    completionStatus: CompletionStatus;
    chunkCount: number | null;
    rowCount: number | null;
    progress: number | null;
    expirationTime: string | null;
    executionStats: ExecutionStats | null;
}

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

export interface ExecuteQueryRequest {
    sql: string;
    transferMode?: "ADAPTIVE" | string;
    settings?: Record<string, unknown>;
    resultRange?: {
        rowLimit?: number;
        byteLimit: number;
    };
    queryRowLimit?: number;
    paramStyle?: "NAMED" | string;
}

export interface GetQueryStatusParams {
    queryId: string;
    waitTimeMs?: number;
}

export interface GetQueryChunkParams {
    queryId: string;
    chunkId: number;
    omitSchema?: boolean;
}

export interface GetQueryRowsParams {
    queryId: string;
    offset: number;
    limit?: number;
    byteLimit?: number;
    omitSchema?: boolean;
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface QueryDataResponse {
    metadata?: { columns: ColumnDefinition[] } | null;
    data: unknown[][];
    returnedRows?: number;
}

export interface QueryErrorResponse {
    error: string;
    message: string;
    details?: {
        customerHint?: string;
        customerDetail?: string;
        errorSource?: string;
        position?: {
            errorBeginCharacterOffset: string;
            errorEndCharacterOffset: string;
        };
    };
}

// ---------------------------------------------------------------------------
// Response format
// ---------------------------------------------------------------------------

export enum ResponseFormat {
    JSON = "application/json",
    ARROW = "application/vnd.apache.arrow.stream",
}

// ---------------------------------------------------------------------------
// Optional request headers
// ---------------------------------------------------------------------------

export interface HyperHttpRequestHeaders {
    workload?: string;
    externalClientContext?: string;
    adaptiveTimeout?: string;
}

// ---------------------------------------------------------------------------
// Auth provider
// ---------------------------------------------------------------------------

export interface HyperHttpAuthProvider {
    getAuthHeaders(): Promise<Record<string, string>>;
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class HyperHttpError extends Error {
    public readonly httpStatus: number;
    public readonly errorResponse: QueryErrorResponse | null;

    constructor(httpStatus: number, errorResponse: QueryErrorResponse | null) {
        super(errorResponse?.message ?? `HTTP ${httpStatus}`);
        this.httpStatus = httpStatus;
        this.errorResponse = errorResponse;
    }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class HyperDatabaseHttpClient {
    httpClient: HttpClient;
    baseUrl: URL;
    auth: HyperHttpAuthProvider;
    logger: Logger;

    constructor(httpClient: HttpClient, baseUrl: URL, auth: HyperHttpAuthProvider, logger: Logger) {
        this.httpClient = httpClient;
        this.baseUrl = baseUrl;
        this.auth = auth;
        this.logger = logger;
    }

    private async buildHeaders(format: ResponseFormat, extra?: HyperHttpRequestHeaders): Promise<Headers> {
        const authHeaders = await this.auth.getAuthHeaders();
        const headers = new Headers({
            "Accept": format,
            "Content-Type": "application/json",
            ...authHeaders,
        });
        if (extra?.workload) {
            headers.set("x-hyperdb-workload", extra.workload);
        }
        if (extra?.externalClientContext) {
            headers.set("x-hyperdb-external-client-context", extra.externalClientContext);
        }
        if (extra?.adaptiveTimeout) {
            headers.set("X-hyperdb-adaptive-timeout", extra.adaptiveTimeout);
        }
        return headers;
    }

    private parseStatusHeader(response: HttpFetchResult): QueryStatus | null {
        const raw = response.headers.get("status");
        if (!raw) return null;
        return JSON.parse(raw) as QueryStatus;
    }

    private async throwIfError(response: HttpFetchResult): Promise<void> {
        if (response.status >= 400) {
            let errorBody: QueryErrorResponse | null = null;
            try {
                errorBody = await response.json() as QueryErrorResponse;
            } catch {
                // Response body may not be valid JSON
            }
            throw new HyperHttpError(response.status, errorBody);
        }
    }

    /// POST /v3/query
    async executeQuery(request: ExecuteQueryRequest, format: ResponseFormat = ResponseFormat.ARROW, extra?: HyperHttpRequestHeaders, abort?: AbortSignal): Promise<{ status: QueryStatus | null; response: HttpFetchResult }> {
        const url = new URL("/v3/query", this.baseUrl);
        const headers = await this.buildHeaders(format, extra);
        const response = await this.httpClient.fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(request),
            signal: abort,
        });
        await this.throwIfError(response);
        const status = this.parseStatusHeader(response);
        return { status, response };
    }

    /// GET /v3/query/{queryId}
    async getQueryStatus(params: GetQueryStatusParams, abort?: AbortSignal): Promise<QueryStatus> {
        const url = new URL(`/v3/query/${encodeURIComponent(params.queryId)}`, this.baseUrl);
        if (params.waitTimeMs !== undefined) {
            url.searchParams.set("waitTimeMs", params.waitTimeMs.toString());
        }
        const headers = await this.buildHeaders(ResponseFormat.JSON);
        const response = await this.httpClient.fetch(url, {
            method: "GET",
            headers,
            signal: abort,
        });
        await this.throwIfError(response);
        return await response.json() as QueryStatus;
    }

    /// DELETE /v3/query/{queryId}
    async cancelQuery(queryId: string, abort?: AbortSignal): Promise<void> {
        const url = new URL(`/v3/query/${encodeURIComponent(queryId)}`, this.baseUrl);
        const headers = await this.buildHeaders(ResponseFormat.JSON);
        const response = await this.httpClient.fetch(url, {
            method: "DELETE",
            headers,
            signal: abort,
        });
        await this.throwIfError(response);
    }

    /// GET /v3/query/{queryId}/chunk/{chunkId}
    async getQueryChunk(params: GetQueryChunkParams, format: ResponseFormat = ResponseFormat.ARROW, extra?: HyperHttpRequestHeaders, abort?: AbortSignal): Promise<{ status: QueryStatus | null; response: HttpFetchResult }> {
        const url = new URL(`/v3/query/${encodeURIComponent(params.queryId)}/chunk/${params.chunkId}`, this.baseUrl);
        if (params.omitSchema) {
            url.searchParams.set("omitSchema", "true");
        }
        const headers = await this.buildHeaders(format, extra);
        const response = await this.httpClient.fetch(url, {
            method: "GET",
            headers,
            signal: abort,
        });
        await this.throwIfError(response);
        const status = this.parseStatusHeader(response);
        return { status, response };
    }

    /// GET /v3/query/{queryId}/row
    async getQueryRows(params: GetQueryRowsParams, format: ResponseFormat = ResponseFormat.ARROW, extra?: HyperHttpRequestHeaders, abort?: AbortSignal): Promise<HttpFetchResult> {
        const url = new URL(`/v3/query/${encodeURIComponent(params.queryId)}/row`, this.baseUrl);
        url.searchParams.set("offset", params.offset.toString());
        if (params.limit !== undefined) {
            url.searchParams.set("limit", params.limit.toString());
        }
        if (params.byteLimit !== undefined) {
            url.searchParams.set("byteLimit", params.byteLimit.toString());
        }
        if (params.omitSchema) {
            url.searchParams.set("omitSchema", "true");
        }
        const headers = await this.buildHeaders(format, extra);
        const response = await this.httpClient.fetch(url, {
            method: "GET",
            headers,
            signal: abort,
        });
        await this.throwIfError(response);
        return response;
    }
}

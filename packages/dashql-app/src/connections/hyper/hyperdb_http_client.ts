import { HttpClient, HttpFetchResult } from '../../platform/http/http_client.js';
import { Logger, LoggableException } from '../../platform/logger/logger.js';

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

/// The order in which a query advances through the completion states
const COMPLETION_STATUS_RANK: Record<CompletionStatus, number> = {
    RUNNING_OR_UNSPECIFIED: 0,
    RESULTS_PRODUCED: 1,
    FINISHED: 2,
};

/// Read a number that the server may serialize as a JSON string
function readNumber(value: unknown): number | null {
    const n = typeof value === "string" ? Number(value) : value;
    return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/// Read a query status from a status header or a status response.
/// The status response serializes chunkCount and rowCount as strings.
export function readQueryStatus(raw: any): QueryStatus {
    const stats = raw.executionStats;
    return {
        queryId: raw.queryId,
        completionStatus: raw.completionStatus ?? "RUNNING_OR_UNSPECIFIED",
        chunkCount: readNumber(raw.chunkCount),
        rowCount: readNumber(raw.rowCount),
        progress: readNumber(raw.progress),
        expirationTime: raw.expirationTime ?? null,
        executionStats: stats ? {
            wallClockTime: readNumber(stats.wallClockTime) ?? 0,
            rowsProcessed: readNumber(stats.rowsProcessed) ?? 0,
        } : null,
    };
}

function maxOrNull(a: number | null, b: number | null): number | null {
    return a == null ? b : b == null ? a : Math.max(a, b);
}

/// Merge a status into the current one.
/// Responses of parallel requests arrive in any order, an older status must not roll back a newer one.
export function mergeQueryStatus(current: QueryStatus, update: QueryStatus): QueryStatus {
    const currentRank = COMPLETION_STATUS_RANK[current.completionStatus] ?? 0;
    const updateRank = COMPLETION_STATUS_RANK[update.completionStatus] ?? 0;
    const a = current.executionStats;
    const b = update.executionStats;
    return {
        queryId: current.queryId,
        completionStatus: updateRank >= currentRank ? update.completionStatus : current.completionStatus,
        chunkCount: maxOrNull(current.chunkCount, update.chunkCount),
        rowCount: maxOrNull(current.rowCount, update.rowCount),
        progress: maxOrNull(current.progress, update.progress),
        expirationTime: update.expirationTime ?? current.expirationTime,
        executionStats: a && b ? {
            wallClockTime: Math.max(a.wallClockTime, b.wallClockTime),
            rowsProcessed: Math.max(a.rowsProcessed, b.rowsProcessed),
        } : (b ?? a),
    };
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
    databases?: {
        path: string;
        alias?: string;
    }[];
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

export interface QueryErrorResponse {
    error: string;
    message: string;
    details?: {
        customerHint?: string;
        customerDetail?: string;
        systemDetail?: string;
        errorSource?: string;
        position?: {
            errorBeginCharacterOffset: string;
            errorEndCharacterOffset: string;
        };
    };
}

export class HyperHttpError extends LoggableException {
    public readonly httpStatus: number;
    public readonly errorResponse: QueryErrorResponse | null;

    constructor(httpStatus: number, errorResponse: QueryErrorResponse | null, diagnostics: Record<string, string | null> = {}) {
        super(errorResponse?.message || errorResponse?.error || `HTTP ${httpStatus}`, diagnostics, LOG_CTX);
        this.httpStatus = httpStatus;
        this.errorResponse = errorResponse;
    }
}

/// The maximum length of a raw header value in the error diagnostics
const MAX_DIAGNOSTIC_LENGTH = 2000;
/// How deep to search nested objects for an error
const MAX_ERROR_SEARCH_DEPTH = 3;

function truncate(text: string, maxLength: number): string {
    return text.length <= maxLength ? text : `${text.substring(0, maxLength)}...`;
}

function nonEmptyString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value : undefined;
}

/// Read a Hyper ErrorInfo serialized as JSON, in camelCase or snake_case
function readErrorInfo(raw: any, httpStatus: number): QueryErrorResponse | null {
    const primaryMessage = nonEmptyString(raw.primaryMessage ?? raw.primary_message);
    if (!primaryMessage) return null;
    const position = raw.position;
    const begin = position?.errorBeginCharacterOffset ?? position?.error_begin_character_offset;
    const end = position?.errorEndCharacterOffset ?? position?.error_end_character_offset;
    return {
        error: nonEmptyString(raw.sqlstate) ?? `HTTP ${httpStatus}`,
        message: primaryMessage,
        details: {
            customerHint: nonEmptyString(raw.customerHint ?? raw.customer_hint),
            customerDetail: nonEmptyString(raw.customerDetail ?? raw.customer_detail),
            systemDetail: nonEmptyString(raw.systemDetail ?? raw.system_detail),
            errorSource: nonEmptyString(raw.errorSource ?? raw.error_source),
            position: begin != null && end != null ? {
                errorBeginCharacterOffset: String(begin),
                errorEndCharacterOffset: String(end),
            } : undefined,
        },
    };
}

/// Read an error from a JSON error body or the JSON status header.
/// Recognizes the V3 error envelope, Salesforce error arrays, Hyper ErrorInfo objects,
/// google.rpc.Status objects with packed details, and any of these nested in other objects.
export function readErrorResponse(raw: unknown, httpStatus: number, depth: number = 0): QueryErrorResponse | null {
    if (raw == null || typeof raw !== 'object' || depth > MAX_ERROR_SEARCH_DEPTH) return null;
    if (Array.isArray(raw)) {
        for (const entry of raw) {
            const error = readErrorResponse(entry, httpStatus, depth + 1);
            if (error) return error;
        }
        return null;
    }
    const obj = raw as Record<string, any>;

    // Hyper ErrorInfo
    const errorInfo = readErrorInfo(obj, httpStatus);
    if (errorInfo) return errorInfo;

    // google.rpc.Status, prefer a packed ErrorInfo over the terse message
    if (Array.isArray(obj.details)) {
        for (const detail of obj.details) {
            if (detail && typeof detail === 'object') {
                const info = readErrorInfo(detail, httpStatus);
                if (info) return info;
            }
        }
    }

    // V3 error envelope or Salesforce error
    const message = nonEmptyString(obj.message);
    const error = nonEmptyString(obj.error);
    const errorCode = nonEmptyString(obj.errorCode);
    if (message || error || errorCode) {
        return {
            ...obj,
            message: message ?? '',
            error: error ?? errorCode ?? `HTTP ${httpStatus}`,
            details: obj.details != null && typeof obj.details === 'object' && !Array.isArray(obj.details) ? obj.details : undefined,
        } as QueryErrorResponse;
    }

    // An error nested in another object, e.g. the error of a query status
    for (const value of Object.values(obj)) {
        const nested = readErrorResponse(value, httpStatus, depth + 1);
        if (nested) return nested;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class HyperDatabaseHttpClient {
    httpClient: HttpClient;
    /// The Hyper endpoint URL (the Salesforce Data Cloud instance URL).
    endpointUrl: URL;
    auth: HyperHttpAuthProvider;
    logger: Logger;

    constructor(httpClient: HttpClient, endpointUrl: URL, auth: HyperHttpAuthProvider, logger: Logger) {
        this.httpClient = httpClient;
        this.endpointUrl = endpointUrl;
        this.auth = auth;
        this.logger = logger;
    }

    private async buildHeaders(extra?: HyperHttpRequestHeaders): Promise<Headers> {
        const authHeaders = await this.auth.getAuthHeaders();
        const headers = new Headers({
            "Accept": "application/vnd.apache.arrow.stream",
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
        const raw = response.headers.get("x-hyperdb-status");
        if (!raw) return null;
        return readQueryStatus(JSON.parse(raw));
    }

    private async throwIfError(response: HttpFetchResult): Promise<void> {
        if (response.status >= 400) {
            let errorBody: QueryErrorResponse | null = null;
            let errorOrigin = 'none';
            let bodyType = 'unreadable';
            let bodyKeys = '';
            try {
                const body = await response.json();
                bodyType = body == null ? 'null' : Array.isArray(body) ? 'array' : typeof body;
                bodyKeys = body != null && typeof body === 'object'
                    ? Object.keys(Array.isArray(body) ? (body[0] ?? {}) : body)
                        .filter(key => ['message', 'error', 'errorCode', 'details', 'detail'].includes(key)).join(',')
                    : '';
                errorBody = readErrorResponse(body, response.status);
                if (errorBody) errorOrigin = 'body';
            } catch {
                // Response body may not be valid JSON
            }
            // The body may be empty and the error is only in the status header
            const rawStatus = response.headers.get('x-hyperdb-status');
            if (errorBody == null && rawStatus) {
                try {
                    errorBody = readErrorResponse(JSON.parse(rawStatus), response.status);
                    if (errorBody) errorOrigin = 'x-hyperdb-status';
                } catch {
                    // Status header may not be valid JSON
                }
            }
            const diagnostics = {
                status: response.status.toString(),
                statusText: response.statusText,
                contentType: response.headers.get('content-type'),
                hyperdbStatusPresent: (rawStatus != null).toString(),
                hyperdbStatus: rawStatus != null ? truncate(rawStatus, MAX_DIAGNOSTIC_LENGTH) : null,
                bodyType,
                bodyKeys,
                hyperErrorRecognized: (errorBody != null).toString(),
                hyperErrorOrigin: errorOrigin,
            };
            this.logger.warn('Hyper HTTP error response', diagnostics, LOG_CTX);
            throw new HyperHttpError(response.status, errorBody, diagnostics);
        }
    }

    /// POST /api/v3/query
    async executeQuery(request: ExecuteQueryRequest, extra?: HyperHttpRequestHeaders, abort?: AbortSignal): Promise<{ status: QueryStatus | null; response: HttpFetchResult }> {
        const url = new URL("/api/v3/query", this.endpointUrl);
        const headers = await this.buildHeaders(extra);
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

    /// GET /api/v3/query/{queryId}
    async getQueryStatus(params: GetQueryStatusParams, abort?: AbortSignal): Promise<QueryStatus> {
        const url = new URL(`/api/v3/query/${encodeURIComponent(params.queryId)}`, this.endpointUrl);
        if (params.waitTimeMs !== undefined) {
            url.searchParams.set("waitTimeMs", params.waitTimeMs.toString());
        }
        const headers = await this.buildHeaders();
        const response = await this.httpClient.fetch(url, {
            method: "GET",
            headers,
            signal: abort,
        });
        await this.throwIfError(response);
        return readQueryStatus(await response.json());
    }

    /// DELETE /api/v3/query/{queryId}
    async cancelQuery(queryId: string, abort?: AbortSignal): Promise<void> {
        const url = new URL(`/api/v3/query/${encodeURIComponent(queryId)}`, this.endpointUrl);
        const headers = await this.buildHeaders();
        const response = await this.httpClient.fetch(url, {
            method: "DELETE",
            headers,
            signal: abort,
        });
        await this.throwIfError(response);
    }

    /// GET /api/v3/query/{queryId}/chunk/{chunkId}
    async getQueryChunk(params: GetQueryChunkParams, extra?: HyperHttpRequestHeaders, abort?: AbortSignal): Promise<{ status: QueryStatus | null; response: HttpFetchResult }> {
        const url = new URL(`/api/v3/query/${encodeURIComponent(params.queryId)}/chunk/${params.chunkId}`, this.endpointUrl);
        if (params.omitSchema) {
            url.searchParams.set("omitSchema", "true");
        }
        const headers = await this.buildHeaders(extra);
        const response = await this.httpClient.fetch(url, {
            method: "GET",
            headers,
            signal: abort,
        });
        await this.throwIfError(response);
        const status = this.parseStatusHeader(response);
        return { status, response };
    }

    /// GET /api/v3/query/{queryId}/row
    async getQueryRows(params: GetQueryRowsParams, extra?: HyperHttpRequestHeaders, abort?: AbortSignal): Promise<HttpFetchResult> {
        const url = new URL(`/api/v3/query/${encodeURIComponent(params.queryId)}/row`, this.endpointUrl);
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
        const headers = await this.buildHeaders(extra);
        const response = await this.httpClient.fetch(url, {
            method: "GET",
            headers,
            signal: abort,
        });
        await this.throwIfError(response);
        return response;
    }
}

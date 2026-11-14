import { LoggableException } from "./logger/logger.js";

export interface ChannelTlsSettings {
    /// The mTLS client key path
    keyPath?: string;
    /// The mTLS client certificate path
    pubPath?: string;
    /// The mTLS ca certificates path
    caPath?: string;
}

export interface ChannelArgs {
    /// The endpoint url
    endpoint: string,
    /// The channel tls settings
    tls?: ChannelTlsSettings;
}

export interface RawProxyError {
    /// The error
    message: string;
    /// Error data produced by TypeScript proxy clients.
    data?: Record<string, string>;
    /// Error data produced by the native Rust proxy.
    details?: Record<string, string>;
}

export function getProxyErrorData(error: RawProxyError): Record<string, string> {
    return error.data ?? error.details ?? {};
}

export class ChannelError extends LoggableException {
    /// The status code
    statusCode: number;
    /// The response headers
    headers: Headers | null;

    constructor(error: RawProxyError, status: number, headers?: Headers, target?: string) {
        super(error.message, getProxyErrorData(error), target);
        this.statusCode = status;
        this.headers = headers ?? null;
    }
}

export interface ChannelMetadataProvider {
    /// Get additional request metadata.
    /// Retrieving the request metadata might involve refreshing the OAuth token, thus the promise.
    getRequestMetadata(): Promise<Record<string, string>>;
}

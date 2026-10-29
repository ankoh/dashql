import type { BatchRequest, BatchResult } from './batch.js';

export interface BatchWorkerRequest {
    requestId: number;
    request: BatchRequest;
}

export type BatchWorkerResponse =
    | { requestId: number; result: BatchResult }
    /// A fatal error leaves the worker unusable, e.g. a panic of the core
    | { requestId: number; error: string; fatal?: boolean };

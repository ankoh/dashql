import { DuckDBWorker, WorkerGlobalsLike } from './duckdb_worker.js';
import { DuckDB } from './duckdb_api.js';

export interface MessageEventLike<T = any> {
    data: T;
}

export type WorkerEventChannel = 'message' | 'error' | 'messageerror';

export interface WorkerLike {
    postMessage(message: any, transfer: Transferable[]): void;
    addEventListener(channel: WorkerEventChannel, handler: (event: MessageEventLike) => void): void;
    removeEventListener(channel: WorkerEventChannel, handler: (event: MessageEventLike) => void): void;
    terminate(): void;
}

class InlineWorkerBase {
    eventListeners: Map<WorkerEventChannel, ((event: MessageEventLike) => void)[]> = new Map();

    addEventListener(channel: WorkerEventChannel, handler: (event: MessageEventLike) => void): void {
        const listeners = this.eventListeners.get(channel) ?? [];
        listeners.push(handler);
        this.eventListeners.set(channel, listeners);
    }

    removeEventListener(channel: WorkerEventChannel, handler: (event: MessageEventLike) => void): void {
        const listeners = this.eventListeners.get(channel) ?? [];
        this.eventListeners.set(
            channel,
            listeners.filter((l) => l != handler),
        );
    }
}

class InlinedWorker extends InlineWorkerBase implements WorkerLike {
    public workerThread: InlinedWorkerGlobals | null = null;

    terminate(): void {}

    postMessage(message: any, _transfer: Transferable[]): void {
        for (const listener of this.workerThread!.eventListeners.get('message') ?? []) {
            listener({ data: message });
        }
    }
}

class InlinedWorkerGlobals extends InlineWorkerBase implements WorkerGlobalsLike {
    public mainThread: InlinedWorker | null = null;

    postMessage(message: any, _transfer: Transferable[]): void {
        console.assert(this.mainThread != null);
        for (const listener of this.mainThread!.eventListeners.get('message') ?? []) {
            listener({ data: message });
        }
    }
}

function createInlineWorker(): [InlinedWorker, InlinedWorkerGlobals] {
    const worker = new InlinedWorker();
    const workerGlobals = new InlinedWorkerGlobals();
    worker.workerThread = workerGlobals;
    workerGlobals.mainThread = worker;
    return [worker, workerGlobals];
}

export async function instantiateTestWebDB(wasmBinaryOrUrl: Uint8Array | string): Promise<DuckDB> {
    const [worker, workerGlobals] = createInlineWorker();

    const webdb = new DuckDB(worker as any);
    const webdbWorker = new DuckDBWorker(workerGlobals);

    // For test workers, inject the WASM binary directly if provided
    if (wasmBinaryOrUrl instanceof Uint8Array) {
        (webdbWorker as any).testWasmBinary = wasmBinaryOrUrl;
    }

    webdbWorker.attach();

    // Instantiate the worker
    await webdb.ping();

    // If given a Uint8Array, we pass an empty string since the binary is injected
    // For now, if it's a string, use it as URL
    if (typeof wasmBinaryOrUrl === 'string') {
        await webdb.instantiate(wasmBinaryOrUrl);
    } else {
        // Pass empty string - the worker will use the injected binary
        await webdb.instantiate('');
    }

    return webdb;
}

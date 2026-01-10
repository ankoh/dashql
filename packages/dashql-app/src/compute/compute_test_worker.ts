import { TestLogger } from "../platform/test_logger.js";
import { ComputeWorker, WorkerGlobalsLike } from "./compute_worker.js";
import { ComputeWorkerBindings, MessageEventLike, WorkerEventChannel, WorkerLike } from "./compute_worker_bindings.js";

class InlineWorkerBase {
    /// The event listeners
    eventListeners: Map<WorkerEventChannel, ((event: MessageEventLike) => void)[]> = new Map();

    /// Register an event listener for the worker
    addEventListener(channel: WorkerEventChannel, handler: (event: MessageEventLike) => void): void {
        const listeners = this.eventListeners.get(channel) ?? [];
        listeners.push(handler);
        this.eventListeners.set(channel, listeners);
    }
    /// Remove an event listener from the worker
    removeEventListener(channel: WorkerEventChannel, handler: (event: MessageEventLike) => void): void {
        const listeners = this.eventListeners.get(channel) ?? [];
        this.eventListeners.set(channel, listeners.filter(l => l != handler));
    }
}

class InlinedWorker extends InlineWorkerBase implements WorkerLike {
    /// The worker thread
    public workerThread: InlinedWorkerGlobals | null = null;

    /// Terminate a worker
    terminate(): void { }
    /// Post a message to the worker
    postMessage(message: any, _transfer: Transferable[]): void {
        for (const listener of this.workerThread!.eventListeners.get("message") ?? []) {
            listener({ data: message });
        }
    }
}

class InlinedWorkerGlobals extends InlineWorkerBase implements WorkerGlobalsLike {
    /// The main thread
    public mainThread: InlinedWorker | null = null;

    /// Post a message to the worker
    postMessage(message: any, _transfer: Transferable[]): void {
        console.assert(this.mainThread != null);
        for (const listener of this.mainThread!.eventListeners.get("message") ?? []) {
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

export async function instantiateTestWorker(wasmPath: string, logger: TestLogger): Promise<ComputeWorkerBindings> {
    const [worker, workerGlobals] = createInlineWorker();

    const computeWorkerBindings = new ComputeWorkerBindings(logger, worker);
    const computeWorker = new ComputeWorker(workerGlobals);
    computeWorker.attach();

    // Instantiate the worker
    await computeWorkerBindings.instantiate(wasmPath);
    return computeWorkerBindings;
}

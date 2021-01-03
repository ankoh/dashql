import { WebDBBindings } from './webdb_bindings';
import { WAPIResponse, WAPIRequest } from './worker_api_message';

export abstract class WorkerAPI {
    /// The bindings
    _bindings: WebDBBindings | null;

    /// Constructor
    constructor() {
        this._bindings = null;
    }

    /// Instantiate the wasm module
    protected abstract open(path: string | null): Promise<WebDBBindings>;
    /// Post a response to the main thread
    protected abstract postMessage(response: WAPIResponse): void;
    /// Process a request from the main thread
    public onMessage(_request: WAPIRequest) {}
}

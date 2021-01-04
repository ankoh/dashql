import { WebDBBindings } from './webdb_bindings';
import { AsyncWebDBResponse, AsyncWebDBRequest, AsyncWebDBMessageType } from './async_webdb_message';

export abstract class AsyncWebDBDispatcher {
    /// The bindings
    _bindings: WebDBBindings | null = null;

    /// Instantiate the wasm module
    protected abstract open(path: string | null): Promise<WebDBBindings>;
    /// Post a response to the main thread
    protected abstract postMessage(response: AsyncWebDBResponse, transfer: ArrayBuffer[]): void;

    /// Process a request from the main thread
    public onMessage(request: AsyncWebDBRequest) {
        switch (request.type) {
            case AsyncWebDBMessageType.PING:
                postMessage({
                    id: request.id,
                    type: AsyncWebDBMessageType.PONG,
                    data: null
                })
                break;
        }
    }
}

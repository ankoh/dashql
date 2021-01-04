import { WebDBBindings } from './webdb_bindings';
import { AsyncWebDBResponseVariant, AsyncWebDBRequestVariant, AsyncWebDBRequestType, AsyncWebDBResponseType } from './async_webdb_message';

export abstract class AsyncWebDBDispatcher {
    /// The bindings
    _bindings: WebDBBindings | null = null;
    /// The next message id
    _nextMessageId: number = 0;

    /// Instantiate the wasm module
    protected abstract open(path: string | null): Promise<WebDBBindings>;
    /// Post a response to the main thread
    protected abstract postMessage(response: AsyncWebDBResponseVariant, transfer: ArrayBuffer[]): void;

    /// Process a request from the main thread
    public onMessage(request: AsyncWebDBRequestVariant) {
        switch (request.type) {
            case AsyncWebDBRequestType.PING:
                this.postMessage({
                    messageId: this._nextMessageId++,
                    requestId: request.messageId,
                    type: AsyncWebDBResponseType.PONG,
                    data: null
                }, []);
                break;
        }
    }
}

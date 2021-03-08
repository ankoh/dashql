import { WebDBBindings } from './webdb_bindings';
import {
    AsyncWebDBResponseVariant,
    AsyncWebDBRequestVariant,
    AsyncWebDBRequestType,
    AsyncWebDBResponseType,
} from './async_webdb_message';
import { Logger, LogEntryVariant } from './log';

export abstract class AsyncWebDBDispatcher implements Logger {
    /// The bindings
    _bindings: WebDBBindings | null = null;
    /// The next message id
    _nextMessageId: number = 0;

    /// Instantiate the wasm module
    protected abstract open(path: string | null): Promise<WebDBBindings>;
    /// Post a response to the main thread
    protected abstract postMessage(response: AsyncWebDBResponseVariant, transfer: ArrayBuffer[]): void;

    /// Send log entry to the main thread
    public log(entry: LogEntryVariant) {
        this.postMessage(
            {
                messageId: this._nextMessageId++,
                requestId: 0,
                type: AsyncWebDBResponseType.LOG,
                data: entry,
            },
            [],
        );
    }

    /// Send plain OK without further data
    protected sendOK(request: AsyncWebDBRequestVariant) {
        this.postMessage(
            {
                messageId: this._nextMessageId++,
                requestId: request.messageId,
                type: AsyncWebDBResponseType.OK,
                data: null,
            },
            [],
        );
    }

    /// Fail with an error
    protected failWith(request: AsyncWebDBRequestVariant, data: any) {
        this.postMessage(
            {
                messageId: this._nextMessageId++,
                requestId: request.messageId,
                type: AsyncWebDBResponseType.ERROR,
                data: data,
            },
            [],
        );
        return;
    }

    /// Process a request from the main thread
    public async onMessage(request: AsyncWebDBRequestVariant) {
        // First process those requests that don't need bindings
        switch (request.type) {
            case AsyncWebDBRequestType.PING:
                this.sendOK(request);
                return;
            case AsyncWebDBRequestType.OPEN:
                if (this._bindings != null) {
                    this.failWith(request, new Error('webdb already initialized'));
                }
                try {
                    this._bindings = await this.open(request.data);
                    this.sendOK(request);
                } catch (e) {
                    this._bindings = null;
                    this.failWith(request, e);
                }
                return;
            default:
                break;
        }

        // Bindings not initialized?
        if (!this._bindings) {
            return this.failWith(request, new Error('webdb is not initialized'));
        }

        // Catch every exception and forward it as error message to the main thread
        try {
            switch (request.type) {
                case AsyncWebDBRequestType.RESET:
                    this._bindings = null;
                    this.sendOK(request);
                    break;
                case AsyncWebDBRequestType.CONNECT:
                    const conn = this._bindings.connect();
                    this.postMessage(
                        {
                            messageId: this._nextMessageId++,
                            requestId: request.messageId,
                            type: AsyncWebDBResponseType.CONNECTION_INFO,
                            data: conn.handle,
                        },
                        [],
                    );
                    break;
                case AsyncWebDBRequestType.DISCONNECT:
                    this._bindings.disconnect(request.data);
                    this.sendOK(request);
                    break;
                case AsyncWebDBRequestType.RUN_QUERY: {
                    const result = this._bindings.runQuery(request.data[0], request.data[1], request.data[2]);
                    const bytes = result.bb!.bytes();
                    this.postMessage(
                        {
                            messageId: this._nextMessageId++,
                            requestId: request.messageId,
                            type: AsyncWebDBResponseType.QUERY_RESULT,
                            data: result.bb!.bytes(),
                        },
                        [bytes.buffer],
                    );
                    break;
                }
                case AsyncWebDBRequestType.SEND_QUERY: {
                    const result = this._bindings.sendQuery(request.data[0], request.data[1], request.data[2]);
                    const bytes = result.bb!.bytes();
                    this.postMessage(
                        {
                            messageId: this._nextMessageId++,
                            requestId: request.messageId,
                            type: AsyncWebDBResponseType.QUERY_RESULT,
                            data: bytes,
                        },
                        [bytes.buffer],
                    );
                    break;
                }
                case AsyncWebDBRequestType.FETCH_QUERY_RESULTS: {
                    const result = this._bindings.fetchQueryResults(request.data);
                    const bytes = result.bb!.bytes();
                    this.postMessage(
                        {
                            messageId: this._nextMessageId++,
                            requestId: request.messageId,
                            type: AsyncWebDBResponseType.QUERY_RESULT_CHUNK,
                            data: result.bb!.bytes(),
                        },
                        [bytes.buffer],
                    );
                    break;
                }
            }
        } catch (e) {
            return this.failWith(request, e);
        }
    }
}

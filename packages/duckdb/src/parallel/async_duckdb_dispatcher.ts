import { DuckDBBindings } from '../bindings';
import {
    AsyncDuckDBResponseVariant,
    AsyncDuckDBRequestVariant,
    AsyncDuckDBRequestType,
    AsyncDuckDBResponseType,
} from './async_duckdb_message';
import { Logger, LogEntryVariant } from '../common';

export abstract class AsyncDuckDBDispatcher implements Logger {
    /** The bindings */
    _bindings: DuckDBBindings | null = null;
    /** The next message id */
    _nextMessageId: number = 0;

    /** Instantiate the wasm module */
    protected abstract open(path: string): Promise<DuckDBBindings>;
    /** Post a response to the main thread */
    protected abstract postMessage(response: AsyncDuckDBResponseVariant, transfer: ArrayBuffer[]): void;

    /** Send log entry to the main thread */
    public log(entry: LogEntryVariant) {
        this.postMessage(
            {
                messageId: this._nextMessageId++,
                requestId: 0,
                type: AsyncDuckDBResponseType.LOG,
                data: entry,
            },
            [],
        );
    }

    /** Send plain OK without further data */
    protected sendOK(request: AsyncDuckDBRequestVariant) {
        this.postMessage(
            {
                messageId: this._nextMessageId++,
                requestId: request.messageId,
                type: AsyncDuckDBResponseType.OK,
                data: null,
            },
            [],
        );
    }

    /** Fail with an error */
    protected failWith(request: AsyncDuckDBRequestVariant, data: any) {
        this.postMessage(
            {
                messageId: this._nextMessageId++,
                requestId: request.messageId,
                type: AsyncDuckDBResponseType.ERROR,
                data: data,
            },
            [],
        );
        return;
    }

    /** Process a request from the main thread */
    public async onMessage(request: AsyncDuckDBRequestVariant) {
        // First process those requests that don't need bindings
        switch (request.type) {
            case AsyncDuckDBRequestType.PING:
                this.sendOK(request);
                return;
            case AsyncDuckDBRequestType.OPEN:
                if (this._bindings != null) {
                    this.failWith(request, new Error('duckdb already initialized'));
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
            return this.failWith(request, new Error('duckdb is not initialized'));
        }

        // Catch every exception and forward it as error message to the main thread
        try {
            switch (request.type) {
                case AsyncDuckDBRequestType.RESET:
                    this._bindings = null;
                    this.sendOK(request);
                    break;
                case AsyncDuckDBRequestType.CONNECT:
                    const conn = this._bindings.connect();
                    this.postMessage(
                        {
                            messageId: this._nextMessageId++,
                            requestId: request.messageId,
                            type: AsyncDuckDBResponseType.CONNECTION_INFO,
                            data: conn.handle,
                        },
                        [],
                    );
                    break;
                case AsyncDuckDBRequestType.DISCONNECT:
                    this._bindings.disconnect(request.data);
                    this.sendOK(request);
                    break;
                case AsyncDuckDBRequestType.RUN_QUERY: {
                    const result = this._bindings.runQuery(request.data[0], request.data[1], request.data[2]);
                    const bytes = result.bb!.bytes();
                    this.postMessage(
                        {
                            messageId: this._nextMessageId++,
                            requestId: request.messageId,
                            type: AsyncDuckDBResponseType.QUERY_RESULT,
                            data: result.bb!.bytes(),
                        },
                        [bytes.buffer],
                    );
                    break;
                }
                case AsyncDuckDBRequestType.SEND_QUERY: {
                    const result = this._bindings.sendQuery(request.data[0], request.data[1], request.data[2]);
                    const bytes = result.bb!.bytes();
                    this.postMessage(
                        {
                            messageId: this._nextMessageId++,
                            requestId: request.messageId,
                            type: AsyncDuckDBResponseType.QUERY_RESULT,
                            data: bytes,
                        },
                        [bytes.buffer],
                    );
                    break;
                }
                case AsyncDuckDBRequestType.FETCH_QUERY_RESULTS: {
                    const result = this._bindings.fetchQueryResults(request.data);
                    const bytes = result.bb!.bytes();
                    this.postMessage(
                        {
                            messageId: this._nextMessageId++,
                            requestId: request.messageId,
                            type: AsyncDuckDBResponseType.QUERY_RESULT_CHUNK,
                            data: result.bb!.bytes(),
                        },
                        [bytes.buffer],
                    );
                    break;
                }
                case AsyncDuckDBRequestType.IMPORT_CSV:
                    this._bindings.importCSV(request.data[0], request.data[1], request.data[2], request.data[3]);
                    this.sendOK(request);
                    break;
                case AsyncDuckDBRequestType.REGISTER_URL:
                    await this._bindings.registerURL(request.data);
                    this.sendOK(request);
                    break;
                case AsyncDuckDBRequestType.OPEN_URL: {
                    let blobId = this._bindings.openURL(request.data);
                    this.postMessage(
                        {
                            messageId: this._nextMessageId++,
                            requestId: request.messageId,
                            type: AsyncDuckDBResponseType.BLOB_ID,
                            data: blobId,
                        },
                        [],
                    );
                    break;
                }
            }
        } catch (e) {
            // Workaround for Firefox not being able to perform structured-clone on Native Errors
            // https://bugzilla.mozilla.org/show_bug.cgi?id=1556604
            let obj: any = {};
            Object.getOwnPropertyNames(e).forEach(key => (obj[key] = e[key]));

            return this.failWith(request, obj);
        }
    }
}

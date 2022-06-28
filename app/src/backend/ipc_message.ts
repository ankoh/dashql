export type DatabaseID = number;
export type ConnectionID = number;

export enum IPCFType {
    BACKEND_CONFIGURE_DATABASE = 'BACKEND_CONFIGURE_DATABASE',
    BACKEND_CONFIGURE_WORKFLOW = 'BACKEND_CONFIGURE_WORKFLOW',
    DATABASE_OPEN = 'DATABASE_OPEN',
    DATABASE_CLOSE = 'DATABASE_OPEN',
    DATABASE_CONNECTION_CREATE = 'DATABASE_CONNECTION_CREATE',
    DATABASE_CONNECTION_CLOSE = 'DATABASE_CONNECTION_CLOSE',
    DATABASE_RUN_QUERY = 'DATABASE_RUN_QUERY',
    WORKFLOW_SESSION_CREATE = 'WORKFLOW_SESSION_CREATE',
    WORKFLOW_SESSION_CLOSE = 'WORKFLOW_SESSION_CLOSE',
    WORKFLOW_UPDATE_PROGRAM = 'WORKFLOW_UPDATE_PROGRAM',
}

export enum IPCBType {
    DATABASE_ID = 'DATABASE_ID',
    DATABASE_CONNECTION_ID = 'DATABASE_CONNECTION_ID',
    DATABASE_QUERY_RESULT = 'DATABASE_QUERY_RESULT',
    WORKFLOW_SESSION_ID = 'WORKFLOW_SESSION_ID',
    WORKFLOW_UPDATE_BATCH_BEGIN = 'WORKFLOW_UPDATE_BATCH_BEGIN',
    WORKFLOW_UPDATE_BATCH_END = 'WORKFLOW_UPDATE_BATCH_END',
    WORKFLOW_UPDATE_PROGRAM = 'WORKFLOW_UPDATE_PROGRAM',
    WORKFLOW_UPDATE_TASK_GRAPH = 'WORKFLOW_UPDATE_TASK_GRAPH',
    WORKFLOW_UPDATE_TASK_STATUS = 'WORKFLOW_UPDATE_TASK_STATUS',
    WORKFLOW_DELETE_TASK_STATE = 'WORKFLOW_DELETE_TASK_STATE',
    WORKFLOW_UPDATE_INPUT_STATE = 'WORKFLOW_UPDATE_INPUT_STATE',
    WORKFLOW_UPDATE_IMPORT_STATE = 'WORKFLOW_UPDATE_IMPORT_STATE',
    WORKFLOW_UPDATE_LOAD_STATE = 'WORKFLOW_UPDATE_LOAD_STATE',
    WORKFLOW_UPDATE_TABLE_STATE = 'WORKFLOW_UPDATE_TABLE_STATE',
    WORKFLOW_UPDATE_VISUALIZATION_STATE = 'WORKFLOW_UPDATE_VISUALIZATION_STATE',
}

export type IPCFrontendMessage<T, P> = {
    readonly messageId: number;
    readonly type: T;
    readonly data: P;
};

export type IPCBackendMessage<T, P> = {
    readonly messageId: number;
    readonly requestId: number;
    readonly type: T;
    readonly data: P;
};

export type IPCBackendCallResult<T extends IPCBackendCall> = T extends IPCCall<IPCFType, IPCBType, any, infer P>
    ? P
    : never;

export class IPCCall<TYPE_IN, TYPE_OUT, DATA_IN, DATA_OUT> {
    readonly requestType: TYPE_IN;
    readonly responseType: TYPE_OUT;
    readonly data: DATA_IN;
    promise: Promise<DATA_OUT>;
    promiseResolver: (value: DATA_OUT | PromiseLike<DATA_OUT>) => void = () => {};
    promiseRejecter: (value: any) => void = () => {};

    constructor(request: TYPE_IN, response: TYPE_OUT, data: DATA_IN) {
        this.requestType = request;
        this.responseType = response;
        this.data = data;
        this.promise = new Promise<DATA_OUT>(
            (resolve: (value: DATA_OUT | PromiseLike<DATA_OUT>) => void, reject: (reason?: void) => void) => {
                this.promiseResolver = resolve;
                this.promiseRejecter = reject;
            },
        );
    }
}

export type IPCFrontendMessageVariant =
    | IPCFrontendMessage<IPCFType.DATABASE_OPEN, string | null>
    | IPCFrontendMessage<IPCFType.DATABASE_CLOSE, ConnectionID>;

export type IPCBackendMessageVariant =
    | IPCBackendMessage<IPCBType.DATABASE_ID, number>
    | IPCBackendMessage<IPCBType.DATABASE_CONNECTION_ID, number>
    | IPCBackendMessage<IPCBType.DATABASE_QUERY_RESULT, Uint8Array>;

export type IPCBackendCall =
    | IPCCall<IPCFType.BACKEND_CONFIGURE_DATABASE, null, null, null>
    | IPCCall<IPCFType.BACKEND_CONFIGURE_WORKFLOW, null, null, null>
    | IPCCall<IPCFType.DATABASE_OPEN, IPCBType.DATABASE_ID, null, number>
    | IPCCall<IPCFType.DATABASE_CLOSE, null, DatabaseID, null>
    | IPCCall<IPCFType.DATABASE_CONNECTION_CREATE, null, DatabaseID, ConnectionID>
    | IPCCall<IPCFType.DATABASE_CONNECTION_CLOSE, null, ConnectionID, null>
    | IPCCall<IPCFType.DATABASE_RUN_QUERY, IPCBType.DATABASE_QUERY_RESULT, ConnectionID, Uint8Array>
    | IPCCall<IPCFType.WORKFLOW_SESSION_CREATE, IPCBType.WORKFLOW_SESSION_ID, null, number>
    | IPCCall<IPCFType.WORKFLOW_SESSION_CLOSE, null, number, null>
    | IPCCall<IPCFType.WORKFLOW_UPDATE_PROGRAM, null, string, null>;

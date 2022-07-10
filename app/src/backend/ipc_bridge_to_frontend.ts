import { TaskGraph } from 'src/model/task_graph';
import { TaskStatusCode } from 'src/model/task_status';
import { SessionId, StateId, TaskId, WorkflowFrontend } from './workflow_backend';

export type DatabaseID = number;
export type ConnectionID = number;

export enum IPCFrontendMessageType {
    BATCH_UPDATE_BEGIN = 'BATCH_UPDATE_BEGIN',
    BATCH_UPDATE_END = 'BATCH_UPDATE_END',
    UPDATE_PROGRAM = 'UPDATE_PROGRAM',
    UPDATE_TASK_GRAPH = 'UPDATE_TASK_GRAPH',
    UPDATE_TASK_STATUS = 'UPDATE_TASK_STATUS',
    DELETE_TASK_STATE = 'DELETE_TASK_STATE',
    UPDATE_INPUT_STATE = 'UPDATE_INPUT_STATE',
    UPDATE_IMPORT_STATE = 'UPDATE_IMPORT_STATE',
    UPDATE_LOAD_STATE = 'UPDATE_LOAD_STATE',
    UPDATE_TABLE_STATE = 'UPDATE_TABLE_STATE',
    UPDATE_VISUALIZATION_STATE = 'UPDATE_VISUALIZATION_STATE',
}

export type IPCFrontendMessage<T, P> = {
    readonly type: T;
    readonly data: P;
};

export type IPCWorkflowFrontendMessage =
    | IPCFrontendMessage<IPCFrontendMessageType.BATCH_UPDATE_BEGIN, BatchUpdateBeginMsg>
    | IPCFrontendMessage<IPCFrontendMessageType.BATCH_UPDATE_END, BatchUpdateEndMsg>
    | IPCFrontendMessage<IPCFrontendMessageType.UPDATE_PROGRAM, UpdateProgramMsg>
    | IPCFrontendMessage<IPCFrontendMessageType.UPDATE_TASK_GRAPH, UpdateTaskGraphMsg>
    | IPCFrontendMessage<IPCFrontendMessageType.UPDATE_TASK_STATUS, UpdateTaskStatusMsg>
    | IPCFrontendMessage<IPCFrontendMessageType.DELETE_TASK_STATE, DeleteTaskMsg>
    | IPCFrontendMessage<IPCFrontendMessageType.UPDATE_INPUT_STATE, UpdateInputMsg>
    | IPCFrontendMessage<IPCFrontendMessageType.UPDATE_IMPORT_STATE, UpdateImportMsg>
    | IPCFrontendMessage<IPCFrontendMessageType.UPDATE_LOAD_STATE, UpdateLoadMsg>
    | IPCFrontendMessage<IPCFrontendMessageType.UPDATE_TABLE_STATE, UpdateTableMsg>
    | IPCFrontendMessage<IPCFrontendMessageType.UPDATE_VISUALIZATION_STATE, UpdateVisualizationMsg>;

interface BatchUpdateBeginMsg {
    session: SessionId;
}

interface BatchUpdateEndMsg {
    session: SessionId;
}

interface UpdateProgramMsg {
    session: SessionId;
    program: Uint8Array;
}

interface UpdateTaskGraphMsg {
    session: SessionId;
    graph: any;
}

interface UpdateTaskStatusMsg {
    session: SessionId;
    task: number;
    status: TaskStatusCode;
    error?: any;
}

interface DeleteTaskMsg {
    session: SessionId;
    state: StateId;
}

interface UpdateInputMsg {
    session: SessionId;
    state: StateId;
}

interface UpdateImportMsg {
    session: SessionId;
    state: StateId;
}

interface UpdateLoadMsg {
    session: SessionId;
    state: StateId;
}

interface UpdateTableMsg {
    session: SessionId;
    state: StateId;
}

interface UpdateVisualizationMsg {
    session: SessionId;
    state: StateId;
}

export function createIPCWorkflowFrontendBridge(
    send: (session: SessionId, msg: IPCWorkflowFrontendMessage) => void,
): WorkflowFrontend {
    return {
        beginBatchUpdate: (session: SessionId) =>
            send(session, { type: IPCFrontendMessageType.BATCH_UPDATE_BEGIN, data: null }),
        endBatchUpdate: (session: SessionId) =>
            send(session, { type: IPCFrontendMessageType.BATCH_UPDATE_END, data: null }),
        updateProgram: (session: SessionId, program: Uint8Array | null) =>
            send(session, { type: IPCFrontendMessageType.UPDATE_PROGRAM, data: { session, program } }),
        updateTaskGraph: (session: SessionId, graph: TaskGraph | null) =>
            send(session, { type: IPCFrontendMessageType.UPDATE_TASK_GRAPH, data: { session, graph } }),
        updateTaskStatus: (session: SessionId, task: TaskId, status: TaskStatusCode, error?: any) =>
            send(session, {
                type: IPCFrontendMessageType.UPDATE_TASK_STATUS,
                data: {
                    session,
                    task,
                    status,
                    error,
                },
            }),
        deleteTaskState: (session: SessionId, state: StateId) =>
            send(session, { type: IPCFrontendMessageType.DELETE_TASK_STATE, data: { session, state } }),
        updateInputState: (session: SessionId, state: StateId) =>
            send(session, { type: IPCFrontendMessageType.UPDATE_INPUT_STATE, data: { session, state } }),
        updateImportState: (session: SessionId, state: StateId) =>
            send(session, { type: IPCFrontendMessageType.UPDATE_IMPORT_STATE, data: { session, state } }),
        updateLoadState: (session: SessionId, state: StateId) =>
            send(session, { type: IPCFrontendMessageType.UPDATE_LOAD_STATE, data: { session, state } }),
        updateTableState: (session: SessionId, state: StateId) =>
            send(session, { type: IPCFrontendMessageType.UPDATE_TABLE_STATE, data: { session, state } }),
        updateVisualizationState: (session: SessionId, state: StateId) =>
            send(session, { type: IPCFrontendMessageType.UPDATE_VISUALIZATION_STATE, data: { session, state } }),
    };
}

export function invokeIPCWorkflowFrontend(frontend: WorkflowFrontend, message: IPCWorkflowFrontendMessage) {
    switch (message.type) {
        case IPCFrontendMessageType.BATCH_UPDATE_BEGIN:
            return frontend.beginBatchUpdate(message.data.session);
        case IPCFrontendMessageType.BATCH_UPDATE_END:
            return frontend.endBatchUpdate(message.data.session);
        case IPCFrontendMessageType.UPDATE_PROGRAM:
            return frontend.updateProgram(message.data.session, message.data.program);
        case IPCFrontendMessageType.UPDATE_TASK_GRAPH:
            return frontend.updateTaskGraph(message.data.session, message.data.graph);
        case IPCFrontendMessageType.UPDATE_TASK_STATUS:
            return frontend.updateTaskStatus(
                message.data.session,
                message.data.task,
                message.data.status,
                message.data.error,
            );
        case IPCFrontendMessageType.DELETE_TASK_STATE:
            return frontend.deleteTaskState(message.data.session, message.data.state);
        case IPCFrontendMessageType.UPDATE_INPUT_STATE:
            return frontend.updateInputState(message.data.session, message.data.state);
        case IPCFrontendMessageType.UPDATE_IMPORT_STATE:
            return frontend.updateImportState(message.data.session, message.data.state);
        case IPCFrontendMessageType.UPDATE_LOAD_STATE:
            return frontend.updateLoadState(message.data.session, message.data.state);
        case IPCFrontendMessageType.UPDATE_TABLE_STATE:
            return frontend.updateTableState(message.data.session, message.data.state);
        case IPCFrontendMessageType.UPDATE_VISUALIZATION_STATE:
            return frontend.updateVisualizationState(message.data.session, message.data.state);
        default:
            break;
    }
}

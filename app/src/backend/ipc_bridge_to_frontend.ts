import { VizSpec } from 'src/model';
import { TaskStatusCode } from 'src/model/task_status';
import { ProgramId, SessionId, DataId, TaskId, WorkflowFrontend } from './backend';

export type DatabaseID = number;
export type ConnectionID = number;

export enum IPCFrontendMessageType {
    FLUSH_UPDATES = 'FLUSH_UPDATES',
    UPDATE_PROGRAM = 'UPDATE_PROGRAM',
    UPDATE_PROGRAM_ANALYSIS = 'UPDATE_PROGRAM_ANALYSIS',
    UPDATE_PROGRAM_TEXT = 'UPDATE_PROGRAM_TEXT',
    UPDATE_TASK_GRAPH = 'UPDATE_TASK_GRAPH',
    UPDATE_TASK_STATUS = 'UPDATE_TASK_STATUS',
    DELETE_TASK_DATA = 'DELETE_TASK_DATA',
    UPDATE_INPUT_DATA = 'UPDATE_INPUT_DATA',
    UPDATE_IMPORT_DATA = 'UPDATE_IMPORT_DATA',
    UPDATE_LOAD_DATA = 'UPDATE_LOAD_DATA',
    UPDATE_TABLE_DATA = 'UPDATE_TABLE_DATA',
    UPDATE_VISUALIZATION_DATA = 'UPDATE_VISUALIZATION_DATA',
}

export type IPCFrontendMessage<T, P> = {
    readonly type: T;
    readonly data: P;
};

export type IPCWorkflowFrontendMessage =
    | IPCFrontendMessage<IPCFrontendMessageType.FLUSH_UPDATES, FlushUpdatesMsg>
    | IPCFrontendMessage<IPCFrontendMessageType.UPDATE_PROGRAM, UpdateProgramMsg>
    | IPCFrontendMessage<IPCFrontendMessageType.UPDATE_PROGRAM_ANALYSIS, UpdateProgramAnalysisMsg>
    | IPCFrontendMessage<IPCFrontendMessageType.UPDATE_TASK_GRAPH, UpdateTaskGraphMsg>
    | IPCFrontendMessage<IPCFrontendMessageType.UPDATE_TASK_STATUS, UpdateTaskStatusMsg>
    | IPCFrontendMessage<IPCFrontendMessageType.DELETE_TASK_DATA, DeleteTaskMsg>
    | IPCFrontendMessage<IPCFrontendMessageType.UPDATE_INPUT_DATA, UpdateInputMsg>
    | IPCFrontendMessage<IPCFrontendMessageType.UPDATE_IMPORT_DATA, UpdateImportMsg>
    | IPCFrontendMessage<IPCFrontendMessageType.UPDATE_LOAD_DATA, UpdateLoadMsg>
    | IPCFrontendMessage<IPCFrontendMessageType.UPDATE_TABLE_DATA, UpdateTableMsg>
    | IPCFrontendMessage<IPCFrontendMessageType.UPDATE_VISUALIZATION_DATA, UpdateVisualizationMsg>;

interface FlushUpdatesMsg {
    session: SessionId;
}

interface UpdateProgramMsg {
    sessionId: SessionId;
    programId: ProgramId;
    text: Uint8Array;
    program: Uint8Array;
}

interface UpdateProgramAnalysisMsg {
    session: SessionId;
    analysis: string;
}

interface UpdateTaskGraphMsg {
    session: SessionId;
    graph: string;
}

interface UpdateTaskStatusMsg {
    session: SessionId;
    task: number;
    status: TaskStatusCode;
    error?: any;
}

interface DeleteTaskMsg {
    session: SessionId;
    state: DataId;
}

interface UpdateInputMsg {
    session: SessionId;
    state: DataId;
}

interface UpdateImportMsg {
    session: SessionId;
    state: DataId;
}

interface UpdateLoadMsg {
    session: SessionId;
    state: DataId;
}

interface UpdateTableMsg {
    session: SessionId;
    state: DataId;
}

interface UpdateVisualizationMsg {
    session: SessionId;
    state: DataId;
    spec: VizSpec;
}

export function createIPCWorkflowFrontendBridge(
    send: (session: SessionId, msg: IPCWorkflowFrontendMessage) => void,
): WorkflowFrontend {
    return {
        flushUpdates: (session: SessionId) =>
            send(session, { type: IPCFrontendMessageType.FLUSH_UPDATES, data: { session } }),
        updateProgram: (sessionId: SessionId, programId: ProgramId, text: Uint8Array, program: Uint8Array) =>
            send(sessionId, {
                type: IPCFrontendMessageType.UPDATE_PROGRAM,
                data: { sessionId, programId, text, program },
            }),
        updateProgramAnalysis: (session: SessionId, analysis: string) =>
            send(session, { type: IPCFrontendMessageType.UPDATE_PROGRAM_ANALYSIS, data: { session, analysis } }),
        updateTaskGraph: (session: SessionId, graph: string) =>
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
        deleteTaskData: (session: SessionId, state: DataId) =>
            send(session, { type: IPCFrontendMessageType.DELETE_TASK_DATA, data: { session, state } }),
        updateInputData: (session: SessionId, state: DataId) =>
            send(session, { type: IPCFrontendMessageType.UPDATE_INPUT_DATA, data: { session, state } }),
        updateImportData: (session: SessionId, state: DataId) =>
            send(session, { type: IPCFrontendMessageType.UPDATE_IMPORT_DATA, data: { session, state } }),
        updateLoadData: (session: SessionId, state: DataId) =>
            send(session, { type: IPCFrontendMessageType.UPDATE_LOAD_DATA, data: { session, state } }),
        updateTableData: (session: SessionId, state: DataId) =>
            send(session, { type: IPCFrontendMessageType.UPDATE_TABLE_DATA, data: { session, state } }),
        updateVisualizationData: (session: SessionId, state: DataId, spec: VizSpec) =>
            send(session, { type: IPCFrontendMessageType.UPDATE_VISUALIZATION_DATA, data: { session, state, spec } }),
    };
}

export function invokeIPCWorkflowFrontend(frontend: WorkflowFrontend, message: IPCWorkflowFrontendMessage) {
    switch (message.type) {
        case IPCFrontendMessageType.FLUSH_UPDATES:
            return frontend.flushUpdates(message.data.session);
        case IPCFrontendMessageType.UPDATE_PROGRAM:
            return frontend.updateProgram(
                message.data.sessionId,
                message.data.programId,
                message.data.text,
                message.data.program,
            );
        case IPCFrontendMessageType.UPDATE_TASK_GRAPH:
            return frontend.updateTaskGraph(message.data.session, message.data.graph);
        case IPCFrontendMessageType.UPDATE_TASK_STATUS:
            return frontend.updateTaskStatus(
                message.data.session,
                message.data.task,
                message.data.status,
                message.data.error,
            );
        case IPCFrontendMessageType.DELETE_TASK_DATA:
            return frontend.deleteTaskData(message.data.session, message.data.state);
        case IPCFrontendMessageType.UPDATE_INPUT_DATA:
            return frontend.updateInputData(message.data.session, message.data.state);
        case IPCFrontendMessageType.UPDATE_IMPORT_DATA:
            return frontend.updateImportData(message.data.session, message.data.state);
        case IPCFrontendMessageType.UPDATE_LOAD_DATA:
            return frontend.updateLoadData(message.data.session, message.data.state);
        case IPCFrontendMessageType.UPDATE_TABLE_DATA:
            return frontend.updateTableData(message.data.session, message.data.state);
        case IPCFrontendMessageType.UPDATE_VISUALIZATION_DATA:
            return frontend.updateVisualizationData(message.data.session, message.data.state, message.data.spec);
        default:
            break;
    }
}

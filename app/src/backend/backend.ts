import { TaskStatusCode } from 'src/model/task_status';
import { TaskGraph } from '../model/task_graph';

export type DatabaseId = number;
export type ConnectionId = number;
export type SessionId = number;
export type StateId = number;
export type TaskId = number;

export interface WorkflowBackend {
    configureDefault(): Promise<void>;
    createSession(frontend: WorkflowFrontend): Promise<SessionId>;
    closeSession(session: SessionId): Promise<void>;
    updateProgram(session: SessionId, text: string): Promise<void>;
    runQuery(session: SessionId, text: string): Promise<Uint8Array>;
}

export interface WorkflowFrontend {
    beginBatchUpdate(session: SessionId): void;
    endBatchUpdate(session: SessionId): void;
    updateProgramText(session: SessionId, text: string): void;
    updateProgram(session: SessionId, program: Uint8Array | null): void;
    updateTaskGraph(session: SessionId, graph: TaskGraph | null): void;
    updateTaskStatus(session: SessionId, taskId: TaskId, status: TaskStatusCode, error?: any): void;
    deleteTaskState(session: SessionId, state: StateId): void;
    updateInputState(session: SessionId, state: StateId): void;
    updateImportState(session: SessionId, state: StateId): void;
    updateLoadState(session: SessionId, state: StateId): void;
    updateTableState(session: SessionId, state: StateId): void;
    updateVisualizationState(session: SessionId, state: StateId): void;
}

export interface Backend {
    workflow: WorkflowBackend;
}

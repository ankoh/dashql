import { EditOperationVariant } from '../model';
import { TaskStatusCode } from '../model/task_status';

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
    executeProgram(session: SessionId): Promise<void>;
    editProgram(session: SessionId, edits: EditOperationVariant[]): Promise<void>;
    runQuery(session: SessionId, text: string): Promise<Uint8Array>;
}

export interface WorkflowFrontend {
    flushUpdates(session: SessionId): void;
    updateProgram(session: SessionId, text: Uint8Array, program: Uint8Array): void;
    updateProgramAnalysis(session: SessionId, analysis: string): void;
    updateTaskGraph(session: SessionId, graph: string): void;
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

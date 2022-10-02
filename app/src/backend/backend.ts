import { StatementEditOperation } from '../model';
import { TaskStatusCode } from '../model/task_status';

export type DatabaseId = number;
export type ConnectionId = number;
export type SessionId = number;
export type ProgramId = number;
export type DataId = number;
export type TaskId = number;

export interface WorkflowBackend {
    configureDefault(): Promise<void>;
    createSession(frontend: WorkflowFrontend): Promise<SessionId>;
    closeSession(session: SessionId): Promise<void>;
    updateProgram(session: SessionId, text: string): Promise<void>;
    executeProgram(session: SessionId): Promise<void>;
    editProgram(session: SessionId, edits: StatementEditOperation[]): Promise<void>;
    runQuery(session: SessionId, text: string): Promise<Uint8Array>;
}

export interface WorkflowFrontend {
    flushUpdates(session: SessionId): void;
    updateProgram(sessionId: SessionId, programId: ProgramId, text: Uint8Array, program: Uint8Array): void;
    updateProgramAnalysis(session: SessionId, analysis: string): void;
    updateTaskGraph(session: SessionId, graph: string): void;
    updateTaskStatus(session: SessionId, taskId: TaskId, status: TaskStatusCode, error?: any): void;
    deleteTaskData(session: SessionId, state: DataId): void;
    updateInputData(session: SessionId, state: DataId, input: string): void;
    updateImportData(session: SessionId, state: DataId): void;
    updateLoadData(session: SessionId, state: DataId): void;
    updateTableData(session: SessionId, state: DataId): void;
    updateVisualizationData(session: SessionId, state: DataId, viz: string): void;
}

export interface Backend {
    workflow: WorkflowBackend;
}

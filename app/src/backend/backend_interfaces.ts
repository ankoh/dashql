import { TaskStatusCode } from 'src/model/task_status';
import { TaskClass, TaskGraph } from '../model/task_graph';

export type DatabaseId = number;
export type ConnectionId = number;
export type SessionId = number;
export type StateId = number;
export type TaskId = number;

export interface DatabaseBackend {
    configure(): Promise<void>;
    openDatabase(): Promise<DatabaseId>;
    closeDatabase(db: DatabaseId): Promise<void>;
    createConnection(db: DatabaseId): Promise<ConnectionId>;
    closeConnection(conn: ConnectionId): Promise<void>;
    runQuery(conn: ConnectionId, text: string): Promise<Uint8Array>;
}

export interface WorkflowBackend {
    configure(): Promise<void>;
    createSession(db: DatabaseId, frontend: WorkflowFrontend): Promise<SessionId>;
    closeSession(session: SessionId): Promise<void>;
    updateProgram(session: SessionId, text: string): Promise<void>;
}

export interface WorkflowFrontend {
    beginBatchUpdate(session: SessionId): Promise<void>;
    endBatchUpdate(session: SessionId): Promise<void>;
    updateProgram(session: SessionId, program: Uint8Array | null): Promise<void>;
    updateTaskGraph(session: SessionId, graph: TaskGraph | null): Promise<void>;
    updateTaskStatus(
        session: SessionId,
        taskClass: TaskClass,
        taskId: TaskId,
        status: TaskStatusCode,
        error?: any,
    ): Promise<void>;
    deleteTaskState(session: SessionId, state: StateId): Promise<void>;
    updateInputState(session: SessionId, state: StateId): Promise<void>;
    updateImportState(session: SessionId, state: StateId): Promise<void>;
    updateLoadState(session: SessionId, state: StateId): Promise<void>;
    updateTableState(session: SessionId, state: StateId): Promise<void>;
    updateVisualizationState(session: SessionId, state: StateId): Promise<void>;
}

export interface Backend {
    database: DatabaseBackend;
    workflow: WorkflowBackend;
}

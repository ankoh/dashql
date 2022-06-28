import * as proto from '@dashql/dashql-proto';
import { TaskStatusCode } from 'src/model/task_status';
import { TaskClass, TaskGraph } from '../model/task_graph';

type DatabaseId = number;
type ConnectionId = number;
type SessionId = number;
type StateId = number;

interface DatabaseBackend {
    configure(): Promise<void>;
    openDatabase(): Promise<DatabaseId>;
    closeDatabase(db: DatabaseId): Promise<void>;
    createConnection(db: DatabaseId): Promise<ConnectionId>;
    closeConnection(conn: ConnectionId): Promise<void>;
    runQuery(conn: ConnectionId, text: string): Promise<Uint8Array>;
}

interface WorkflowBackend {
    configure(): Promise<void>;
    createSession(db: DatabaseId): Promise<SessionId>;
    closeSession(session: SessionId): Promise<void>;
    updateProgram(session: SessionId, text: string): Promise<void>;
}

interface WorkflowFrontend {
    beginUpdateBatch(): Promise<void>;
    endUpdateBatch(): Promise<void>;
    updateProgram(session: SessionId, program: proto.Program | null): Promise<void>;
    updateTaskGraph(session: SessionId, graph: TaskGraph | null): Promise<void>;
    updateTaskStatus(
        session: SessionId,
        task_class: TaskClass,
        task_id: number,
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

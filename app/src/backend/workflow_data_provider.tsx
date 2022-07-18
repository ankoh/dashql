import React, { ReactElement } from 'react';
import * as proto from '@dashql/dashql-proto';
import * as imm from 'immutable';
import * as fb from 'flatbuffers';
import { TaskGraph } from '../model/task_graph';
import { TaskStatus, TaskStatusCode } from '../model/task_status';
import { SessionId, StateId, WorkflowFrontend } from './backend';
import { useBackend, useBackendResolver } from './backend_provider';

export type TaskId = number;
export interface SessionStore {
    sessionId: number | null;
    programText: string | null;
    program: proto.Program | null;
    taskGraph: TaskGraph | null;
    taskStatusById: imm.Map<TaskId, TaskStatus>;
}

export const WORKFLOW_DATA_CONTEXT = React.createContext<SessionStore>(null);
export const WORKFLOW_FRONTEND_CONTEXT = React.createContext<WorkflowFrontend>(null);
export const WORKFLOW_SESSION_CONTEXT = React.createContext<number>(null);

export const useWorkflowData = (): SessionStore => React.useContext(WORKFLOW_DATA_CONTEXT);
export const useWorkflowFrontend = (): WorkflowFrontend => React.useContext(WORKFLOW_FRONTEND_CONTEXT);
export const useWorkflowSession = (): number => React.useContext(WORKFLOW_SESSION_CONTEXT);

type WorkflowFrontendProviderProps = {
    children: React.ReactElement | ReactElement[];
};

export const WorkflowDataProvider: React.FC<WorkflowFrontendProviderProps> = (props: WorkflowFrontendProviderProps) => {
    const [committed, setCommitted] = React.useState<SessionStore>({
        sessionId: null,
        programText: null,
        program: null,
        taskGraph: null,
        taskStatusById: null,
    });
    const uncommitted = React.useRef<SessionStore>({
        sessionId: null,
        programText: null,
        program: null,
        taskGraph: null,
        taskStatusById: null,
    });
    const workflow: WorkflowFrontend = React.useMemo(
        () => ({
            beginBatchUpdate: (session: SessionId) => {
                const commit = committed;
                const pending = uncommitted.current;
                if (commit.sessionId != session) {
                    pending.sessionId = session;
                    pending.programText = null;
                    pending.program = null;
                    pending.taskGraph = null;
                    pending.taskStatusById = null;
                } else {
                    pending.sessionId = commit.sessionId;
                    pending.programText = commit.programText;
                    pending.program = commit.program;
                    pending.taskGraph = commit.taskGraph;
                    pending.taskStatusById = commit.taskStatusById;
                }
            },
            endBatchUpdate: (session: SessionId) => {
                const pending = uncommitted.current;
                if (pending.sessionId != session) {
                    setCommitted({
                        sessionId: pending.sessionId,
                        programText: pending.programText,
                        program: pending.program,
                        taskGraph: pending.taskGraph,
                        taskStatusById: pending.taskStatusById,
                    });
                }
            },
            updateProgramText: (session: SessionId, text: string) => {
                const pending = uncommitted.current;
                if (pending.sessionId != session) return;
                pending.programText = text;
            },
            updateProgram: (session: SessionId, program: Uint8Array) => {
                const pending = uncommitted.current;
                if (pending.sessionId != session) return;
                const bb = new fb.ByteBuffer(program);
                pending.program = proto.Program.getRootAsProgram(bb);
            },
            updateTaskGraph: (session: SessionId, graph: TaskGraph | null) => {},
            updateTaskStatus: (session: SessionId, taskId: TaskId, status: TaskStatusCode, error?: any) => {},
            deleteTaskState: (session: SessionId, state: StateId) => {},
            updateInputState: (session: SessionId, state: StateId) => {},
            updateImportState: (session: SessionId, state: StateId) => {},
            updateLoadState: (session: SessionId, state: StateId) => {},
            updateTableState: (session: SessionId, state: StateId) => {},
            updateVisualizationState: (session: SessionId, state: StateId) => {},
        }),
        [],
    );

    return (
        <WORKFLOW_FRONTEND_CONTEXT.Provider value={workflow}>
            <WORKFLOW_DATA_CONTEXT.Provider value={committed}>{props.children}</WORKFLOW_DATA_CONTEXT.Provider>
        </WORKFLOW_FRONTEND_CONTEXT.Provider>
    );
};

type WorkflowSessionProviderProps = {
    children: React.ReactElement;
};

export const WorkflowSessionProvider: React.FC<WorkflowSessionProviderProps> = (
    props: WorkflowSessionProviderProps,
) => {
    const backend = useBackend();
    const resolveBackend = useBackendResolver();
    const frontend = useWorkflowFrontend();
    const [session, setSession] = React.useState<number>();
    const inFlight = React.useRef<Promise<void | null> | null>(null);

    React.useEffect(() => {
        if (!backend.resolving()) {
            resolveBackend();
        }
    });
    React.useEffect(() => {
        if (backend.value == null || inFlight.current != null) {
            return;
        }
        inFlight.current = (async () => {
            const prev = session;
            if (prev != null) {
                setSession(null);
                await backend.value.workflow.closeSession(prev);
            }
            const next = await backend.value.workflow.createSession(frontend);
            setSession(next);
            inFlight.current = null;
        })();
    }, [backend, frontend]);

    return <WORKFLOW_SESSION_CONTEXT.Provider value={session}>{props.children}</WORKFLOW_SESSION_CONTEXT.Provider>;
};

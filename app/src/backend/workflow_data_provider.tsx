import React, { ReactElement } from 'react';
import * as imm from 'immutable';
import * as model from '../model';
import { TaskStatusCode } from '../model/task_status';
import { SessionId, StateId, WorkflowFrontend } from './backend';
import { useBackend, useBackendResolver } from './backend_provider';
import { Program, StatementStatus } from '../model';

export type TaskId = number;
export interface WorkflowData {
    sessionId: number | null;
    program: model.Program | null;
    taskGraph: model.TaskGraph | null;
    statusByTask: imm.Map<TaskId, TaskStatusCode>;
    statusByStatement: imm.List<StatementStatus>;
    cards: imm.List<any>; // TODO
}

export const WORKFLOW_DATA_CONTEXT = React.createContext<WorkflowData>(null);
export const WORKFLOW_FRONTEND_CONTEXT = React.createContext<WorkflowFrontend>(null);
export const WORKFLOW_SESSION_CONTEXT = React.createContext<number>(null);

export const useWorkflowData = (): WorkflowData => React.useContext(WORKFLOW_DATA_CONTEXT);
export const useWorkflowFrontend = (): WorkflowFrontend => React.useContext(WORKFLOW_FRONTEND_CONTEXT);
export const useWorkflowSession = (): number => React.useContext(WORKFLOW_SESSION_CONTEXT);

type WorkflowFrontendProviderProps = {
    children: React.ReactElement | ReactElement[];
};

function resetIfNew(data: WorkflowData, sessionId: SessionId) {
    if (data.sessionId != sessionId) {
        data.sessionId = sessionId;
        data.program = null;
        data.taskGraph = null;
        data.statusByTask = imm.Map();
        data.statusByStatement = imm.List();
    }
}

export const WorkflowDataProvider: React.FC<WorkflowFrontendProviderProps> = (props: WorkflowFrontendProviderProps) => {
    const [committed, setCommitted] = React.useState<WorkflowData>({
        sessionId: null,
        program: null,
        taskGraph: null,
        statusByTask: imm.Map(),
        statusByStatement: imm.List(),
        cards: imm.List(),
    });
    const uncommitted = React.useRef<WorkflowData>({
        sessionId: null,
        program: null,
        taskGraph: null,
        statusByTask: imm.Map(),
        statusByStatement: imm.List(),
        cards: imm.List(),
    });
    const sessionIdRef = React.useRef<number>(null);
    const workflow: WorkflowFrontend = React.useMemo(
        () => ({
            flushUpdates: (session: SessionId) => {
                resetIfNew(uncommitted.current, session);
                const pending = uncommitted.current;
                setCommitted({
                    sessionId: pending.sessionId,
                    program: pending.program,
                    taskGraph: pending.taskGraph,
                    statusByTask: pending.statusByTask,
                    statusByStatement: pending.statusByStatement,
                    cards: pending.cards,
                });
            },
            updateProgram: (session: SessionId, text: Uint8Array, ast: Uint8Array) => {
                resetIfNew(uncommitted.current, session);
                uncommitted.current.program = new Program(text, ast);
            },
            updateProgramAnalysis: (session: SessionId, analysis: string) => {},
            updateTaskGraph: (session: SessionId, graph: model.TaskGraph | null) => {
                resetIfNew(uncommitted.current, session);
                uncommitted.current.taskGraph = graph;
                console.log(graph);
            },
            updateTaskStatus: (session: SessionId, taskId: TaskId, status: TaskStatusCode, error?: any) => {
                console.log(`updateTaskStatus ${taskId} ${status} ${error}`);
            },
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

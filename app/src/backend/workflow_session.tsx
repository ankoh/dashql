import React, { ReactElement } from 'react';
import Immutable from 'immutable';
import * as model from '../model';
import { TaskStatusCode } from '../model/task_status';
import { SessionId, StateId, WorkflowBackend, WorkflowFrontend } from './backend';
import { useBackend, useBackendResolver } from './backend_provider';
import { deriveStatementStatusCode, EditOperationVariant, Program, StatementStatus, TaskGraph } from '../model';

export type TaskId = number;
export interface WorkflowSessionState {
    sessionId: number | null;
    programText: string | null;
    program: model.Program | null;
    programAnalysis: model.ProgramAnalysis | null;
    programTasks: model.TaskGraph | null;
    statusByTask: Immutable.Map<TaskId, TaskStatusCode>;
    statusByStatement: Immutable.Map<number, StatementStatus>;
    cards: Immutable.List<any>; // TODO
}

/// Create state in-place
function initSessionState(state: WorkflowSessionState | null = null, sessionId: number | null = null) {
    state = state ?? ({} as WorkflowSessionState);
    state.sessionId = sessionId;
    state.programText = null;
    state.program = null;
    state.programTasks = null;
    state.statusByTask = Immutable.Map();
    state.statusByStatement = Immutable.Map();
    state.cards = Immutable.List();
    return state;
}

export class WorkflowSession {
    constructor(
        protected _state: WorkflowSessionState,
        protected _backend: WorkflowBackend,
        protected _sessionId: number,
    ) {}

    public get uncommittedState(): WorkflowSessionState {
        return this._state;
    }
    public async close(): Promise<void> {
        await this._backend.closeSession(this._sessionId);
    }
    public async updateProgram(text: string): Promise<void> {
        if (text == this._state.programText) {
            return;
        }
        this._state.programText = text;
        await this._backend.updateProgram(this._sessionId, text);
    }
    public async executeProgram(): Promise<void> {
        await this._backend.executeProgram(this._sessionId);
    }
    public async editProgram(edits: EditOperationVariant[]): Promise<void> {
        const prev = this._state.programText;
        await this._backend.editProgram(this._sessionId, edits);
        // Cmpxchg the program text after editing
        if (this._state.programText == prev) {
            this._state.programText = this._state.program.text;
        }
    }
    public async runQuery(text: string): Promise<Uint8Array> {
        return await this._backend.runQuery(this._sessionId, text);
    }
}

export const WORKFLOW_SESSION_STATE_CONTEXT = React.createContext<WorkflowSessionState>(null);
export const WORKFLOW_SESSION_CONTEXT = React.createContext<WorkflowSession>(null);

export const useWorkflowSessionState = (): WorkflowSessionState => React.useContext(WORKFLOW_SESSION_STATE_CONTEXT);
export const useWorkflowSession = (): WorkflowSession => React.useContext(WORKFLOW_SESSION_CONTEXT);

type WorkflowSessionProviderProps = {
    children: React.ReactElement | ReactElement[];
};

export const WorkflowSessionProvider: React.FC<WorkflowSessionProviderProps> = (
    props: WorkflowSessionProviderProps,
) => {
    const backend = useBackend();
    const resolveBackend = useBackendResolver();
    const [sessionId, setSessionId] = React.useState<number | null>(null);
    const sessionCreation = React.useRef<Promise<void | null> | null>(null);

    // Track workflow data with an uncommitted ref and a committed react state
    const uncommittedState = React.useRef<WorkflowSessionState>(initSessionState());
    const [committedState, setCommittedState] = React.useState<WorkflowSessionState>(initSessionState());

    // Resolve backend (if necessary)
    React.useEffect(() => {
        if (!backend.resolving()) {
            resolveBackend();
        }
    });

    // Build the frontend
    const frontend: WorkflowFrontend = React.useMemo(() => {
        const getSessionState = (sessionId: SessionId | null) => {
            const state = uncommittedState.current;
            return state.sessionId === sessionId ? state : initSessionState(state, sessionId);
        };
        return {
            flushUpdates: (session: SessionId) => {
                const pending = getSessionState(session);
                setCommittedState({ ...pending });
            },
            updateProgram: (sessionId: SessionId, programId: number, text: Uint8Array, ast: Uint8Array) => {
                const s = getSessionState(sessionId);
                s.program = new Program(programId, text, ast);
                console.log(s.program.text);
            },
            updateProgramAnalysis: (session: SessionId, analysisJSON: string) => {
                const s = getSessionState(session);
                const analysis = JSON.parse(analysisJSON) as model.ProgramAnalysis;
                s.programAnalysis = analysis;
            },
            updateTaskGraph: (session: SessionId, graphJSON: string) => {
                const s = getSessionState(session);
                const graph = JSON.parse(graphJSON) as TaskGraph;
                s.programTasks = graph;

                // Collect status mappings to later construct an immutable map
                const statusByStatement = new Map();
                const statusByTask = new Map();
                for (let taskId = 0; taskId < graph.tasks.length; ++taskId) {
                    const task = graph.tasks[taskId];

                    // Map the task status to the task id
                    statusByTask.set(taskId, task.task_status);

                    // Is the task associated with a statement?
                    // If yes, update the statement info
                    if (task.origin_statement !== undefined && task.origin_statement !== null) {
                        const stmtId = task.origin_statement;
                        let status = statusByStatement.get(stmtId);
                        if (status === undefined) {
                            status = {
                                status: task.task_status,
                                totalTasks: 1,
                                totalPerStatus: Array(8).fill(0),
                            };
                        }
                        status.totalPerStatus[task.task_status] += 1;
                        statusByStatement.set(stmtId, status);
                    }
                }
                s.statusByStatement = Immutable.Map(statusByStatement);
                s.statusByTask = Immutable.Map(statusByTask);
            },
            updateTaskStatus: (session: SessionId, taskId: TaskId, newStatus: TaskStatusCode, error?: any) => {
                const s = getSessionState(session);
                let task = s.programTasks.tasks[taskId];
                let prevStatus = s.statusByTask.get(taskId);
                s.statusByTask = s.statusByTask.set(taskId, newStatus);

                // Update the statement status (if any)
                if (task.origin_statement !== undefined && task.origin_statement !== null) {
                    let stmtId = task.origin_statement;
                    let prev = s.statusByStatement.get(stmtId);
                    let stmt = {
                        ...prev,
                        totalPerStatus: [...prev.totalPerStatus],
                    };
                    stmt.totalPerStatus[prevStatus] -= 1;
                    stmt.totalPerStatus[newStatus] += 1;
                    stmt.status = deriveStatementStatusCode(stmt);
                    s.statusByStatement = s.statusByStatement.set(stmtId, stmt);
                }
            },
            deleteTaskState: (session: SessionId, state: StateId) => {},
            updateInputState: (session: SessionId, state: StateId) => {},
            updateImportState: (session: SessionId, state: StateId) => {},
            updateLoadState: (session: SessionId, state: StateId) => {},
            updateTableState: (session: SessionId, state: StateId) => {},
            updateVisualizationState: (session: SessionId, state: StateId) => {},
        };
    }, [setCommittedState]);

    // Create session (if necessary)
    React.useEffect(() => {
        if (backend.value == null || sessionCreation.current != null) {
            return;
        }
        sessionCreation.current = (async () => {
            const prev = sessionId;
            if (prev != null) {
                setSessionId(null);
                await backend.value.workflow.closeSession(prev);
            }
            const next = await backend.value.workflow.createSession(frontend);
            setSessionId(next);
            sessionCreation.current = null;
        })();
    }, [backend, frontend]);

    const session = React.useMemo(() => {
        if (backend.value == null || sessionId == null) {
            return null;
        } else {
            return new WorkflowSession(uncommittedState.current, backend.value.workflow, sessionId);
        }
    }, [backend.value, sessionId]);

    return (
        <WORKFLOW_SESSION_CONTEXT.Provider value={session}>
            <WORKFLOW_SESSION_STATE_CONTEXT.Provider value={committedState}>
                {props.children}
            </WORKFLOW_SESSION_STATE_CONTEXT.Provider>
        </WORKFLOW_SESSION_CONTEXT.Provider>
    );
};

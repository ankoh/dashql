import React, { ReactElement } from 'react';
import Immutable from 'immutable';
import * as model from '../model';
import * as arrow from 'apache-arrow';
import { TaskStatusCode } from '../model/task_status';
import { SessionId, DataId, WorkflowBackend, WorkflowFrontend } from './backend';
import { useBackend, useBackendResolver } from './backend_provider';
import {
    deriveStatementStatusCode,
    StatementEditOperation,
    LogEvent,
    LogLevel,
    LogOrigin,
    LogTopic,
    Program,
    ScriptMetadata,
    ScriptOriginType,
    StatementStatus,
    TaskGraph,
    useLogger,
    VizSpec,
    InputSpec,
    WorkflowData,
    ScalarValue,
} from '../model';

export type TaskId = number;
export interface WorkflowSessionState {
    sessionId: number | null;
    scriptMetadata: ScriptMetadata;
    programText: string;
    program: model.Program | null;
    programInput: Immutable.Map<number, model.ScalarValue>;
    programAnalysis: model.ProgramAnalysis | null;
    programTasks: model.TaskGraph | null;
    statusByTask: Immutable.Map<TaskId, TaskStatusCode>;
    statusByStatement: Immutable.Map<number, StatementStatus>;
    dataById: Immutable.Map<number, WorkflowData>;
    statementDependsOn: Map<number, number[]>;
}

/// Create state in-place
function initSessionState(state: WorkflowSessionState | null = null, sessionId: number | null = null) {
    state = state ?? ({} as WorkflowSessionState);
    state.sessionId = sessionId;
    state.scriptMetadata = {
        origin: {
            originType: ScriptOriginType.LOCAL,
            fileName: `helloworld.dashql`,
        },
        description: '',
    };
    state.programText = '';
    state.program = null;
    state.programInput = Immutable.Map();
    state.programAnalysis = null;
    state.programTasks = null;
    state.statusByTask = Immutable.Map();
    state.statusByStatement = Immutable.Map();
    state.dataById = Immutable.Map();
    state.statementDependsOn = new Map();
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
    public async updateProgram(text: string, metadata: ScriptMetadata | null = null): Promise<void> {
        if (text == this._state.programText && (metadata == null || metadata == this._state.scriptMetadata)) {
            return;
        }
        if (metadata !== null) {
            this._state.scriptMetadata = metadata;
        } else {
            this._state.scriptMetadata.modified = true;
        }
        this._state.programText = text;
        await this._backend.updateProgram(this._sessionId, text);
    }
    public async updateProgramInput(statementId: number, value: ScalarValue) {
        const newInput = this._state.programInput.set(statementId, value);
        await this._backend.updateProgramInput(statementId, newInput.toJSON());
    }
    public async executeProgram(): Promise<void> {
        await this._backend.executeProgram(this._sessionId);
    }
    public async editProgram(edits: StatementEditOperation[]): Promise<void> {
        await this._backend.editProgram(this._sessionId, edits);
    }
    public async runQueryRaw(text: string): Promise<Uint8Array> {
        return await this._backend.runQuery(this._sessionId, text);
    }
    public async runQuery<T extends { [key: string]: arrow.DataType } = any>(text: string): Promise<arrow.Table<T>> {
        const buffer = await this.runQueryRaw(text);
        const reader = arrow.RecordBatchReader.from<T>(buffer);
        console.assert(reader.isSync());
        console.assert(reader.isFile());
        return new arrow.Table(reader as arrow.RecordBatchFileReader);
    }
}

const WORKFLOW_SESSION_STATE_CONTEXT = React.createContext<WorkflowSessionState>(null);
const WORKFLOW_SESSION_CONTEXT = React.createContext<WorkflowSession>(null);

export const useWorkflowSessionState = (): WorkflowSessionState => React.useContext(WORKFLOW_SESSION_STATE_CONTEXT);
export const useWorkflowSession = (): WorkflowSession => React.useContext(WORKFLOW_SESSION_CONTEXT);

type WorkflowSessionProviderProps = {
    children: React.ReactElement | ReactElement[];
};

export const WorkflowSessionProvider: React.FC<WorkflowSessionProviderProps> = (
    props: WorkflowSessionProviderProps,
) => {
    const logger = useLogger();
    const backend = useBackend();
    const resolveBackend = useBackendResolver();
    const [sessionId, setSessionId] = React.useState<number | null>(null);
    const sessionCreation = React.useRef<Promise<void | null> | null>(null);

    // Track workflow data with an uncommitted ref and a committed react state
    const uncommittedState = React.useRef<WorkflowSessionState>(null);
    const [committedData, setCommittedState] = React.useState<WorkflowSessionState>(() => initSessionState());

    // Resolve backend (if necessary)
    React.useEffect(() => {
        uncommittedState.current = initSessionState();
        if (!backend.resolving()) {
            resolveBackend();
        }
    }, []);

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
                if (s.programText !== s.program.text) {
                    s.programText = s.program.text;
                }
            },
            updateProgramAnalysis: (session: SessionId, analysisJSON: string) => {
                const s = getSessionState(session);
                const analysis = JSON.parse(analysisJSON) as model.ProgramAnalysis;
                const dependsOn = new Map();
                for (const dep of analysis.statement_dependencies ?? []) {
                    let deps = dependsOn.get(dep.target_stmt) ?? [];
                    deps.push(dep.source_stmt);
                    dependsOn.set(dep.target_stmt, deps);
                }
                s.programAnalysis = analysis;
                s.statementDependsOn = dependsOn;
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

                logger.log({
                    timestamp: new Date(),
                    level: LogLevel.INFO,
                    origin: LogOrigin.WORKFLOW,
                    topic: LogTopic.TASK,
                    event: LogEvent.CAPTURE,
                    value: `${taskId}: ${error}`,
                });
                if (newStatus == TaskStatusCode.Failed) {
                    console.warn(`[task ${taskId}] failed with error: \`${error}\``);
                }

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
            deleteTaskData: (session: SessionId, dataId: DataId) => {
                const s = getSessionState(session);
                s.dataById = s.dataById.delete(dataId);
            },
            updateInputData: (sessionId: SessionId, dataId: DataId, input: string) => {
                const s = getSessionState(sessionId);
                const spec = JSON.parse(input) as InputSpec;
                s.dataById = s.dataById.set(dataId, {
                    t: 'InputData',
                    v: spec,
                });
            },
            updateImportData: (session: SessionId, state: DataId) => {},
            updateLoadData: (session: SessionId, state: DataId) => {},
            updateTableData: (session: SessionId, state: DataId) => {},
            updateVisualizationData: (sessionId: SessionId, dataId: DataId, viz: string) => {
                const s = getSessionState(sessionId);
                const spec = JSON.parse(viz) as VizSpec;
                s.dataById = s.dataById.set(dataId, {
                    t: 'VizData',
                    v: spec,
                });
            },
        };
    }, [setCommittedState]);

    // Create session (if necessary)
    React.useEffect(() => {
        if (backend.value == null || sessionCreation.current != null) {
            return;
        }
        sessionCreation.current = (async () => {
            if (sessionId != null) {
                setSessionId(null);
                await backend.value.workflow.closeSession(sessionId);
            }
            const next = await backend.value.workflow.createSession(frontend);
            if (uncommittedState.current) {
                initSessionState(uncommittedState.current, next);
            }
            setSessionId(next);
            sessionCreation.current = null;
        })();
    }, [backend, frontend]);

    // Create api
    const session = React.useMemo(() => {
        if (uncommittedState.current == null || backend.value == null || sessionId == null) {
            return null;
        }
        return new WorkflowSession(uncommittedState.current, backend.value.workflow, sessionId);
    }, [backend.value, uncommittedState.current, sessionId]);

    return (
        <WORKFLOW_SESSION_CONTEXT.Provider value={session}>
            <WORKFLOW_SESSION_STATE_CONTEXT.Provider value={committedData}>
                {props.children}
            </WORKFLOW_SESSION_STATE_CONTEXT.Provider>
        </WORKFLOW_SESSION_CONTEXT.Provider>
    );
};

import * as Immutable from "immutable";
import { LogEntry } from "./log";
import { Plan } from "./plan";
import { CachedFileData, CachedHTTPData } from "./cache";
import { ActionSchedulerStatus, ActionID, Action, ActionLogEntry } from "./action";
import { PlanObjectID, PlanObject } from "./plan_object";
import { Program, StatementStatus, ParameterValue } from "./program";
import { Store } from "redux";

export class CoreState {
    /// The log entries
    public logEntries: Immutable.List<LogEntry>;

    /// The file name
    public fileName: string;
    /// The file size
    public fileSize: number;
    /// The file line count
    public fileLineCount: number;
    /// The program text
    public programText: string;
    /// The program
    public program: Program | null;
    /// The program parameters
    public programParameters: Immutable.List<ParameterValue>;
    /// The program status
    public programStatus: Immutable.List<StatementStatus>;

    /// The action scheduler status
    public schedulerStatus: ActionSchedulerStatus;
    /// The plan
    public plan: Plan | null;
    /// The plan objects
    public planObjects: Immutable.Map<PlanObjectID, PlanObject>;
    /// The setup actions
    public planActions: Immutable.Map<ActionID, Action>;
    /// The program actions
    public planActionLog: Immutable.List<ActionLogEntry>;

    /// The cached files
    public cachedFileData: Immutable.Map<string, CachedFileData>;
    /// The cached http data
    public cachedHTTPData: Immutable.Map<string, CachedHTTPData>;

    /// Constructor
    constructor() {
        this.logEntries = Immutable.List<LogEntry>();
        this.fileName = "unnamed.dashql";
        this.fileSize = 0;
        this.fileLineCount = 0;
        this.programText = "";
        this.program = null;
        this.programParameters = Immutable.List<ParameterValue>();
        this.programStatus = Immutable.List<StatementStatus>();
        this.schedulerStatus = ActionSchedulerStatus.Idle;
        this.plan = null;
        this.planObjects = Immutable.Map<PlanObjectID, PlanObject>();
        this.planActions = Immutable.Map<ActionID, Action>();
        this.planActionLog = Immutable.List<ActionLogEntry>();
        this.cachedFileData = Immutable.Map<string, CachedFileData>();
        this.cachedHTTPData = Immutable.Map<string, CachedHTTPData>();
    }
}

export interface DerivedState {
    /// The core state
    core: CoreState;
};

// The store type
export type DerivedReduxStore = Store<DerivedState>;

// Helper to observe a store
export function observeStore<T>(store: DerivedReduxStore, select: (state: DerivedState) => T, onChange: (v: T) => void) {
    let prev: T | null = null;
    const stateChanged = () => {
        const next = select(store.getState());
        if (next !== prev) {
            prev = next;
            onChange(prev!);
        }
    };
    const unsub = store.subscribe(stateChanged);
    stateChanged();
    return unsub;
}

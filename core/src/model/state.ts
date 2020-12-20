import * as Immutable from "immutable";
import { LogEntry } from "./log";
import { Plan } from "./plan";
import { CachedFileData, CachedHTTPData } from "./cache";
import { ActionID, Action, ActionLogEntry } from "./action";
import { PlanObjectID, PlanObject } from "./plan_object";
import { Program } from "./program";
import { Store } from "redux";

export class CoreState {
    /// The log entries
    public logEntries: Immutable.List<LogEntry>;

    /// The program text
    public programText: string;
    /// The program
    public program: Program | null;

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
        this.programText = "";
        this.program = null;
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

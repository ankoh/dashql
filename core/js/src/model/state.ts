import * as Immutable from "immutable";
import { CacheKey, CachedHTTPData, CachedFileData } from "./cache";
import { LogEntry } from "./log";
import { Plan } from "./plan";
import { ActionInfo } from "./action_info";
import { PlanObjectID, PlanObject } from "./plan_object";
import { Program } from "./program";

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
    public planSetupActions: Immutable.List<ActionInfo>;
    /// The program actions
    public planProgramActions: Immutable.List<ActionInfo>;

    /// The cached file data
    public cachedFileData: Immutable.Map<CacheKey, CachedFileData>;
    /// The cached http data
    public cachedHTTPData: Immutable.Map<CacheKey, CachedHTTPData>;

    /// Constructor
    constructor() {
        this.logEntries = Immutable.List<LogEntry>();
        this.programText = "";
        this.program = null;
        this.plan = null;
        this.planObjects = Immutable.Map<PlanObjectID, PlanObject>();
        this.planSetupActions = Immutable.List<ActionInfo>();
        this.planProgramActions = Immutable.List<ActionInfo>();
        this.cachedFileData = Immutable.Map<CacheKey, CachedFileData>();
        this.cachedHTTPData = Immutable.Map<CacheKey, CachedHTTPData>();
    }
}

export interface DerivedState {
    /// The core state
    core: CoreState;
};

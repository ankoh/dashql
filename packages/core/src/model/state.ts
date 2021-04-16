import * as Immutable from 'immutable';
import { LogEntryVariant } from './log';
import { Plan } from './plan';
import { CachedFileData, CachedHTTPData } from './cache';
import { ActionSchedulerStatus } from './action';
import { PlanState, createPlanState } from './plan_state';
import { Program, InputValue } from './program';
import { ProgramInstance } from './program_instance';
import { Script, ScriptURIPrefix } from './script';
import { Store, Unsubscribe } from 'redux';

export class CoreState {
    /// The log entries
    public logEntries: Immutable.List<LogEntryVariant>;

    /// The file name
    public script: Script;
    /// The program
    public program: Program | null;
    /// The program input values
    public programInputValues: Immutable.List<InputValue>;
    /// The program dependencies
    public programDependencies: Map<number, number[]>;
    /// The program instance
    public programInstance: ProgramInstance | null;

    /// The action scheduler status
    public schedulerStatus: ActionSchedulerStatus;
    /// The plan
    public plan: Plan | null;
    /// The database tables
    public planState: PlanState;

    /// The cached files
    public cachedFileData: Immutable.Map<string, CachedFileData>;
    /// The cached http data
    public cachedHTTPData: Immutable.Map<string, CachedHTTPData>;

    /// Constructor
    constructor() {
        this.logEntries = Immutable.List<LogEntryVariant>();
        this.script = {
            text: '',
            uriPrefix: ScriptURIPrefix.TMP,
            uriName: 'unnamed.dashql',
            modified: false,
            lineCount: 0,
        };
        this.program = null;
        this.programInputValues = Immutable.List<InputValue>();
        this.programDependencies = new Map();
        this.programInstance = null;
        this.schedulerStatus = ActionSchedulerStatus.Idle;
        this.plan = null;
        this.planState = createPlanState();
        this.cachedFileData = Immutable.Map<string, CachedFileData>();
        this.cachedHTTPData = Immutable.Map<string, CachedHTTPData>();
    }
}

export interface DerivedState {
    /// The core state
    core: CoreState;
}

// The store type
export type DerivedReduxStore = Store<DerivedState>;

// Helper to observe a store
export function observeStore<T>(
    store: DerivedReduxStore,
    select: (state: DerivedState) => T,
    onChange: (v: T) => void,
): Unsubscribe {
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

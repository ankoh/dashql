import * as Immutable from 'immutable';
import { LogEntryVariant } from './log';
import { Plan } from './plan';
import { CachedFileData, CachedHTTPData } from './cache';
import { ActionSchedulerStatus, ActionHandle, Action } from './action';
import { DatabaseTable } from './database_table';
import { Card } from './card';
import { Program, StatementStatus, InputValue } from './program';
import { ProgramInstance } from './program_instance';
import { Script, ScriptURIPrefix } from './script';
import { Store } from 'redux';

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
    /// The planned program status
    public planProgramStatus: Immutable.List<StatementStatus>;
    /// The setup actions
    public planActions: Immutable.Map<ActionHandle, Action>;
    /// The database tables
    public databaseTables: Immutable.Map<string, DatabaseTable>;
    /// The cards
    public cards: Immutable.Map<string, Card>;

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
        this.planProgramStatus = Immutable.List<StatementStatus>();
        this.planActions = Immutable.Map<ActionHandle, Action>();
        this.databaseTables = Immutable.Map<string, DatabaseTable>();
        this.cards = Immutable.Map<string, Card>();
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
) {
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

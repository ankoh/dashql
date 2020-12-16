import * as Immutable from "immutable";
import { LogEntry } from "./log";
import { Plan } from "./plan";
import { PlanObjectID, PlanObject } from "./plan_object";
import { Program } from "./program";
import { Store } from 'redux';

export class State {
    /// The log entries
    public logEntries: Immutable.List<LogEntry>;
    /// The program text
    public program_text: string;
    /// The program
    public program: Program | null;
    /// The plan
    public plan: Plan | null;
    /// The plan objects
    public planObjects: Immutable.Map<PlanObjectID, PlanObject>;

    /// Constructor
    constructor() {
        this.logEntries = Immutable.List<LogEntry>();
        this.program_text = "";
        this.program = null;
        this.plan = null;
        this.planObjects = Immutable.Map<PlanObjectID, PlanObject>();
    }
}

export interface DerivedState {
    core: State;
};

export type DerivedReduxStore = Store<DerivedState>;

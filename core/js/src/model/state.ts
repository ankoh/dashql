import * as Immutable from "immutable";
import { LogEntry } from "./log";
import { Plan } from "./plan";
import { Program } from "./program";

export class CoreState {
    /// The program text
    public program_text: string;
    /// The program
    public program: Program | null;
    /// The plan
    public plan: Plan | null;
    // The log entries
    public logEntries: Immutable.List<LogEntry>;

    /// Constructor
    constructor() {
        this.program_text = "";
        this.program = null;
        this.plan = null;
        this.logEntries = Immutable.List<LogEntry>();
    }
}

export class State {
    /// The core
    public core: CoreState;

    /// Constructor
    constructor() {
        this.core = new CoreState();
    }
}

import * as Immutable from "immutable";
import * as parser from "@dashql/parser";
import { TaskID, TaskInfo } from "./task";
import { LaunchProgress } from "./launch_progress";
import { LogEntry } from "./log";
import { AppSettings } from "./app_settings";

/// A root state
export class AppState {
    /// The launch progress
    public launchProgress: LaunchProgress;
    // The app config
    public appSettings: AppSettings | null;
    // The tasks
    public tasks: Immutable.Map<number, TaskInfo>;
    // The log entries
    public logEntries: Immutable.List<LogEntry>;
    /// The editor text
    public editorText: string | null;
    /// The current program
    public editorProgram: parser.FlatBuffer<parser.proto.program.Program> | null;
    // The focused viz
    public focusedViz: number | null;

    // Constructor
    constructor() {
        this.launchProgress = new LaunchProgress();
        this.appSettings = null;
        this.tasks = Immutable.Map<TaskID, TaskInfo>();
        this.logEntries = Immutable.List<LogEntry>();
        this.editorText = null;
        this.editorProgram = null;
        this.focusedViz = null;
        return;
    }
}


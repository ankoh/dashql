import * as Immutable from "immutable";
import * as core from "@dashql/core";
import { TaskID, TaskInfo } from "./task";
import { LaunchProgress } from "./launch_progress";
import { LogEntry } from "./log";
import { AppSettings } from "./app_settings";

class ProgramInspectionState {
    /// The hovered path (if any)
    hoveredPath: core.parser.NodePath | null = null;
    /// The focused path (if any)
    focusedPath: core.parser.NodePath | null = null;
    /// The expanded paths
    expandedPaths: Immutable.List<core.parser.NodePath>[] = [];
}

export class AppState {
    /// The launch progress
    public launchProgress: LaunchProgress;
    // The app config
    public appSettings: AppSettings | null;
    // The tasks
    public tasks: Immutable.Map<number, TaskInfo>;
    // The log entries
    public logEntries: Immutable.List<LogEntry>;
    /// The studio program
    public studioProgram: core.parser.Program | null;
    /// The studio inspection state
    public studioInspection: ProgramInspectionState;
    /// The plan
    public plan: core.Plan | null;

    /// Constructor
    constructor() {
        this.launchProgress = new LaunchProgress();
        this.appSettings = null;
        this.tasks = Immutable.Map<TaskID, TaskInfo>();
        this.logEntries = Immutable.List<LogEntry>();
        this.studioProgram = null;
        this.studioInspection = new ProgramInspectionState();
        this.plan = null;
        return;
    }
}


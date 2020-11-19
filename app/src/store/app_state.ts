import * as Immutable from "immutable";
import * as core from "@dashql/core";
import { TaskID, TaskInfo } from "./task";
import { LaunchProgress } from "./launch_progress";
import { LogEntry } from "./log";
import { AppSettings } from "./app_settings";

class ModuleDetails {
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
    /// The editor text
    public editorText: string;
    /// The current module
    public editorModule: core.parser.Module | null;
    /// The model for the module inspector
    public moduleDetails: ModuleDetails;

    /// The focused viz
    public focusedViz: number | null;

    /// Constructor
    constructor() {
        this.launchProgress = new LaunchProgress();
        this.appSettings = null;
        this.tasks = Immutable.Map<TaskID, TaskInfo>();
        this.logEntries = Immutable.List<LogEntry>();
        this.editorText = "";
        this.editorModule = null;
        this.moduleDetails = new ModuleDetails();
        this.focusedViz = null;
        return;
    }
}


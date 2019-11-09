import * as Immutable from 'immutable';
import * as proto from 'tigon-proto';
import { CoreBuffer } from './core_buffer';
import { Viz } from './viz';
import { VizLayout } from './viz_layout';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

// A view
export enum RootView {
    LAUNCHER = 0,
    EXPLORER = 1,
    WORKBOOK = 2,
    LIBRARY = 3,
}

// A log level
export enum LogLevel {
    UNDEFINED = 0,
    DEBUG = 1,
    INFO = 2,
    WARNING = 3,
    ERROR = 4,
}

// A task status
export enum TaskType {
    GENERIC = 0,
    FILE_LOAD = 1,
    HTTP_LOAD = 2,
}

// A task status
export enum TaskStatus {
    PENDING = 0,
    RUNNING = 1,
    WAITING_FOR_USER = 2,
    FINISHED = 3,
    ERROR = 4,
}

// ---------------------------------------------------------------------------
// State Model
// ---------------------------------------------------------------------------

// An application config
export class AppSettings {
}

// The log entry
export class LogEntry {
    public timestamp: Date = new Date();
    public level: LogLevel = LogLevel.UNDEFINED;
    public text: string = "";
}

export type TaskID = number;

// A task
export class TaskInfo {
    public taskID: TaskID = 1;
    public title: string = "";
    public description: string = "";
    public statusTag: TaskStatus = TaskStatus.PENDING;
    public statusText: string = "";
    public error: Error | null = null;
    public timeCreated: Date | null = null;
    public timeQueued: Date | null = null;
    public timeFinished: Date | null = null;
}

// ---------------------------------------------------------------------------
// Launch Progress
// ---------------------------------------------------------------------------

export enum LaunchProgressStatus {
    PENDING = 0,
    STARTED = 1,
    COMPLETED = 2,
    FAILED = 3,
    WARNING = 4,
}

export class LaunchProgress {
    public app_configured: LaunchProgressStatus = LaunchProgressStatus.COMPLETED;
    public version_checked: LaunchProgressStatus = LaunchProgressStatus.STARTED;
    public core_instantiated: LaunchProgressStatus = LaunchProgressStatus.STARTED;
}

// ---------------------------------------------------------------------------
// Root state type
// ---------------------------------------------------------------------------

// A root state
export class RootState {
    // The root view
    public rootView: RootView;

    /// The launch progress
    public launchProgress: LaunchProgress;

    // The app config
    public appSettings: AppSettings | null;
    // The app config load is pending
    public appSettingsLoadPending: boolean;

    // The tasks
    public tasks: Immutable.Map<number, TaskInfo>;

    // The log entries
    public logs: Immutable.List<LogEntry>;

    // The transient TQL program (if any)
    public transientTQLProgram: CoreBuffer<proto.tql.TQLProgram> | null;
    // The transient viz layout (if any)
    public transientVizLayout: VizLayout | null;
    // The transient vizzes (if any)
    public transientVizzes: Immutable.List<Viz>;
    // The transient query results (if any)
    public transientQueryResults: Immutable.List<CoreBuffer<proto.duckdb.QueryResult>>;
    // The transient query plans (if any)
    public transientQueryPlans: Immutable.List<CoreBuffer<proto.duckdb.QueryPlan>>;

    // The focused viz
    public focusedViz: number | null;

    // Constructor
    constructor() {
        this.launchProgress = new LaunchProgress();
        this.appSettings = null;
        this.appSettingsLoadPending = true;
        this.tasks = Immutable.Map<TaskID, TaskInfo>();
        this.logs = Immutable.List<LogEntry>();
        this.rootView = RootView.EXPLORER;
        this.transientTQLProgram = null;
        this.transientVizLayout = null;
        this.transientVizzes = Immutable.List();
        this.transientQueryResults = Immutable.List();
        this.transientQueryPlans = Immutable.List();
        this.focusedViz = null;
        return;
    }
}


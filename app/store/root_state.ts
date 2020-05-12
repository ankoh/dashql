import * as Immutable from 'immutable';
import * as proto from '@tigon/proto';

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

/// The size class
export enum SizeClass {
    SMALL,
    MEDIUM,
    LARGE,
    XLARGE,
}

// ---------------------------------------------------------------------------
// State Model
// ---------------------------------------------------------------------------

// A buffer that is stored in the core
export class CoreBuffer {
    /// The number
    protected offset: number;
    /// The size
    protected size: number;

    /// The constructor
    constructor(offset: number, size: number) {
        this.offset = offset;
        this.size = size;
    }
}

// An application config
export class AppSettings {}

// The log entry
export class LogEntry {
    public timestamp: Date = new Date();
    public level: LogLevel = LogLevel.UNDEFINED;
    public text: string = '';
}

export type TaskID = number;

// A task
export class TaskInfo {
    public taskID: TaskID = 1;
    public title: string = '';
    public description: string = '';
    public statusTag: TaskStatus = TaskStatus.PENDING;
    public statusText: string = '';
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
    public app_configured: LaunchProgressStatus =
        LaunchProgressStatus.COMPLETED;
    public version_checked: LaunchProgressStatus = LaunchProgressStatus.STARTED;
    public core_instantiated: LaunchProgressStatus =
        LaunchProgressStatus.STARTED;
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

    // The TQL statements (if any)
    public tqlStatements: Immutable.List<proto.tql.Statement>;
    // The TQL parameters (if any)
    public tqlParameters: Immutable.Map<string, string>;
    // The TQL load data (if any)
    public tqlLoadData: Immutable.Map<string, CoreBuffer>;
    // The TQL extract data (if any)
    public tqlExtractData: Immutable.Map<string, CoreBuffer>;
    // The TQL query results (if any)
    public tqlQueryResults: Immutable.Map<string, proto.engine.QueryResult>;
    // The TQL query plans (if any)
    public tqlQueryPlans: Immutable.Map<string, proto.engine.QueryPlan>;
    // The TQL visualizations (if any)
    public tqlVisualizations: Immutable.Map<string, proto.engine.QueryPlan>;

    // The focused viz
    public focusedViz: number | null;

    // Constructor
    constructor() {
        this.rootView = RootView.EXPLORER;
        this.launchProgress = new LaunchProgress();
        this.appSettings = null;
        this.appSettingsLoadPending = true;
        this.tasks = Immutable.Map<TaskID, TaskInfo>();
        this.logs = Immutable.List<LogEntry>();
        this.tqlStatements = Immutable.List();
        this.tqlParameters = Immutable.Map();
        this.tqlLoadData = Immutable.Map();
        this.tqlExtractData = Immutable.Map();
        this.tqlQueryResults = Immutable.Map();
        this.tqlQueryPlans = Immutable.Map();
        this.tqlVisualizations = Immutable.Map();
        this.focusedViz = null;
        return;
    }
}

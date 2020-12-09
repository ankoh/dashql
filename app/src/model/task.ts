/// A task status
export enum TaskType {
    GENERIC = 0,
    FILE_LOAD = 1,
    HTTP_LOAD = 2,
}

/// A task status
export enum TaskStatus {
    PENDING = 0,
    RUNNING = 1,
    WAITING_FOR_USER = 2,
    FINISHED = 3,
    ERROR = 4,
}

/// A task ID
export type TaskID = number;

/// A task
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

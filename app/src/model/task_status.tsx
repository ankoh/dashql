export enum TaskStatusCode {
    Pending = 0,
    Skipped = 1,
    Preparing = 2,
    Prepared = 3,
    Executing = 4,
    Blocked = 5,
    Failed = 6,
    Completed = 7,
}

export interface TaskStatus {
    code: TaskStatusCode;
}

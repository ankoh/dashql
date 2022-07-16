export enum TaskStatusCode {
    FAILED,
    SKIPPED,
    COMPLETED,
    RUNNING,
    PENDING,
    BLOCKED,
}

export interface TaskStatus {
    code: TaskStatusCode;
}

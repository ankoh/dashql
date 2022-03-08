// Copyright (c) 2021 The DashQL Authors

export enum Status {
    NONE,
    RUNNING,
    BLOCKED,
    FAILED,
    COMPLETED,
}

export type LazyResolver<Value> = () => Promise<Value | null>;

export interface LazySetup<Value> {
    status: Status;
    value: Value | null;
    error: any | null;
}

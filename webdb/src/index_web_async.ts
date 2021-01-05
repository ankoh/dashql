// Copyright (c) 2020 The DashQL Authors

export * from "./async_webdb";
export * from "./async_iterator";
export * from './value';

import CrossWorker from "./crossworker/index_web";
export function spawnWorker(path: string) {
    return new CrossWorker(path);
}

// Copyright (c) 2020 The DashQL Authors

export * from "./async_webdb";

import CrossWorker from "./crossworker/index_web";
export function spawnWorker(path: string) {
    return new CrossWorker(path);
}
exports = {
    CrossWorker
};

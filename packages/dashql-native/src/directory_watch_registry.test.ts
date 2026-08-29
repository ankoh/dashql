import {EventEmitter} from "node:events";

import {describe, expect, it, vi} from "vitest";

import {DirectoryWatchRegistry} from "./directory_watch_registry.js";

describe("DirectoryWatchRegistry", () => {
    it("uses one destroyed listener for all watches owned by a renderer", () => {
        const registry = new DirectoryWatchRegistry();
        const owner = new EventEmitter();
        const watchers = Array.from({length: 11}, () => ({close: vi.fn()}));

        for (const watcher of watchers) registry.add(owner, watcher);

        expect(owner.listenerCount("destroyed")).toBe(1);
        owner.emit("destroyed");
        for (const watcher of watchers) expect(watcher.close).toHaveBeenCalledOnce();
    });

    it("does not close an explicitly removed watch again on renderer teardown", () => {
        const registry = new DirectoryWatchRegistry();
        const owner = new EventEmitter();
        const watcher = {close: vi.fn()};
        const watchId = registry.add(owner, watcher);

        registry.close(watchId);
        owner.emit("destroyed");

        expect(watcher.close).toHaveBeenCalledOnce();
    });
});

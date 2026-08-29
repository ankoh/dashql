export interface DirectoryWatchOwner {
    once(event: "destroyed", listener: () => void): unknown;
}

export interface DirectoryWatcher {
    close(): void;
}

export class DirectoryWatchRegistry {
    private nextWatchId = 1;
    private readonly watches = new Map<number, {owner: DirectoryWatchOwner; watcher: DirectoryWatcher}>();
    private readonly ownerWatches = new Map<DirectoryWatchOwner, Set<number>>();

    public add(owner: DirectoryWatchOwner, watcher: DirectoryWatcher): number {
        let watchIds = this.ownerWatches.get(owner);
        if (watchIds === undefined) {
            watchIds = new Set();
            this.ownerWatches.set(owner, watchIds);
            owner.once("destroyed", () => {
                for (const watchId of watchIds!) this.close(watchId);
                this.ownerWatches.delete(owner);
            });
        }

        const watchId = this.nextWatchId++;
        watchIds.add(watchId);
        this.watches.set(watchId, {owner, watcher});
        return watchId;
    }

    public close(watchId: number): void {
        const watch = this.watches.get(watchId);
        if (watch === undefined) return;
        watch.watcher.close();
        this.watches.delete(watchId);
        this.ownerWatches.get(watch.owner)?.delete(watchId);
    }
}

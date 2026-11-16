/// The files of the query result cache that the runtime keeps, by the ids that the runtime releases them with
/// (`release` of the cache of the platform): the files that `retain` kept and the pins of the files of the runs. The
/// runtime knows which run keeps which file and when it lets go of it. `close` releases the files that are left when
/// the runtime goes, a file that is kept after it is released at once.
export class CachePins {
    private readonly pins = new Map<number, () => Promise<void>>();
    private nextId = 0;
    private closed = false;

    /// Keep a file by the release of its pin, returns its id. Fails once the pins are closed, the file is released then.
    add(release: () => Promise<void>): number {
        if (this.closed) {
            void release().catch(() => { });
            throw new Error('the runtime was destroyed');
        }
        const id = ++this.nextId;
        this.pins.set(id, release);
        return id;
    }

    /// Release a file, an unknown id releases nothing
    async release(id: number): Promise<void> {
        const release = this.pins.get(id);
        this.pins.delete(id);
        await release?.().catch(() => { });
    }

    /// Release every file that is kept, the files that are kept later are released at once
    async close(): Promise<void> {
        this.closed = true;
        const releases = [...this.pins.values()];
        this.pins.clear();
        await Promise.all(releases.map(release => release().catch(() => { })));
    }
}

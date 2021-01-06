export class Semaphore {
    private tasks: (() => Promise<void>)[] = [];
    count: number;

    constructor(count: number) {
        this.count = count;
    }

    private schedule() {
        if (this.count > 0 && this.tasks.length > 0) {
            this.count--;
            let next = this.tasks.shift();
            if (next === undefined) {
                throw 'Unexpected undefined value in tasks list';
            }
            next();
        }
    }

    public async acquire(): Promise<(() => void)> {
        return new Promise<() => void>((resolve, _reject) => {
            var task = async () => {
                var released = false;
                resolve(() => {
                    if (!released) {
                        released = true;
                        this.count++;
                        this.schedule();
                    }
                });
            };
            this.tasks.push(task);
            this.schedule();
        });
    }

    public async use<T>(f: () => T): Promise<T> {
        const release = await this.acquire();
        try {
            const result = f();
            return result;
        } catch(e) {
            throw e;
        } finally {
            release();
        }
    }

    public async useAsync<T>(f: () => Promise<T>) {
        const release = await this.acquire();
        try {
            const result = await f();
            return result;
        } catch(e) {
            throw e;
        } finally {
            release();
        }
    }
}

export class Mutex extends Semaphore {
    constructor() {
        super(1);
    }
}

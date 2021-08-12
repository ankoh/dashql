// Copyright (c) 2021 The DashQL Authors

import './set_immediate';

export class Semaphore {
    private tasks: (() => Promise<void>)[] = [];
    count: number;

    constructor(count: number) {
        this.count = count;
    }

    private schedule(): void {
        if (this.count > 0 && this.tasks.length > 0) {
            this.count--;
            const next = this.tasks.shift();
            if (next === undefined) {
                throw 'Unexpected undefined value in tasks list';
            }
            next();
        }
    }

    public async acquire(): Promise<() => void> {
        return new Promise<() => void>((resolve, _reject) => {
            const task = async () => {
                let released = false;
                resolve(() => {
                    if (!released) {
                        released = true;
                        this.count++;
                        this.schedule();
                    }
                });
            };
            this.tasks.push(task);
            setImmediate(this.schedule.bind(this));
        });
    }

    public async use<T>(f: () => T): Promise<T> {
        const release = await this.acquire();
        try {
            const result = f();
            return result;
        } finally {
            release();
        }
    }

    public async useAsync<T>(f: () => Promise<T>): Promise<T> {
        const release = await this.acquire();
        try {
            const result = await f();
            return result;
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

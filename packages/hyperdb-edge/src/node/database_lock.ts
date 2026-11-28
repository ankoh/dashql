import { randomUUID } from 'node:crypto';
import { linkSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';

/// Another living process holds the database
export class DatabaseInUseError extends Error {
    constructor(
        readonly database: string,
        readonly pid: number,
    ) {
        super(`the database ${database} is in use by process ${pid}`);
        this.name = 'DatabaseInUseError';
    }
}

export interface LockOptions {
    readonly pid?: number;
    readonly isAlive?: (pid: number) => boolean;
}

/// The lock file of a database, next to it
export function lockPathOf(database: string): string {
    return `${database}.lock`;
}

function processIsAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        // The process exists but belongs to another user
        return (e as NodeJS.ErrnoException).code === 'EPERM';
    }
}

function readLockPid(lockPath: string): number | null {
    try {
        const text = readFileSync(lockPath, 'utf8').trim();
        return /^\d+$/.test(text) ? Number(text) : null;
    } catch {
        return null;
    }
}

/// Create the lock file with the process id in it. A file of its own is linked to the lock path, which fails if the
/// lock exists, so a second process never reads a lock file before it holds the id.
function createLockFile(lockPath: string, pid: number): void {
    const temporary = `${lockPath}.${pid}.${randomUUID()}`;
    writeFileSync(temporary, `${pid}\n`, { flag: 'wx' });
    try {
        linkSync(temporary, lockPath);
    } finally {
        unlinkSync(temporary);
    }
}

/// Lock a database file for this process and return the function that releases it.
/// hyperdb-wasm leaves it to the caller to keep a second engine away from a database. The lock is a file next to the
/// database that holds the id of the process; the lock of a process that ended is taken over.
export function acquireDatabaseLock(database: string, options: LockOptions = {}): () => void {
    const pid = options.pid ?? process.pid;
    const isAlive = options.isAlive ?? processIsAlive;
    const lockPath = lockPathOf(database);

    for (let attempt = 0; ; ++attempt) {
        try {
            createLockFile(lockPath, pid);
            break;
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'EEXIST' || attempt > 0) throw e;
            const holder = readLockPid(lockPath);
            if (holder != null && holder !== pid && isAlive(holder)) {
                throw new DatabaseInUseError(database, holder);
            }
            if (holder === pid) throw new DatabaseInUseError(database, holder);
            // The holder ended, or the file holds no process id
            unlinkSync(lockPath);
        }
    }

    let released = false;
    return () => {
        if (released) return;
        released = true;
        if (readLockPid(lockPath) === pid) {
            try {
                unlinkSync(lockPath);
            } catch {
                // Removed meanwhile
            }
        }
    };
}

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { acquireDatabaseLock, DatabaseInUseError, lockPathOf } from './database_lock.js';

let directory: string;
let database: string;

beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'hyperdb-edge-lock-'));
    database = path.join(directory, 'sales.hyper');
});

afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
});

describe('acquireDatabaseLock', () => {
    it('writes the process id into a lock file next to the database and removes it on release', () => {
        const release = acquireDatabaseLock(database);
        expect(lockPathOf(database)).toBe(path.join(directory, 'sales.hyper.lock'));
        expect(readFileSync(lockPathOf(database), 'utf8')).toBe(`${process.pid}\n`);
        release();
        expect(existsSync(lockPathOf(database))).toBe(false);
    });

    it('leaves no file but the lock next to the database', () => {
        const release = acquireDatabaseLock(database, { pid: 1007, isAlive: () => true });
        expect(() => acquireDatabaseLock(database, { pid: 1008, isAlive: () => true })).toThrow(DatabaseInUseError);
        expect(readdirSync(directory)).toEqual(['sales.hyper.lock']);
        release();
        expect(readdirSync(directory)).toEqual([]);
    });

    it('refuses a database that a living process holds', () => {
        const release = acquireDatabaseLock(database, { pid: 1001, isAlive: () => true });
        expect(() => acquireDatabaseLock(database, { pid: 1002, isAlive: () => true })).toThrow(DatabaseInUseError);
        try {
            acquireDatabaseLock(database, { pid: 1002, isAlive: () => true });
        } catch (e) {
            expect((e as DatabaseInUseError).pid).toBe(1001);
            expect((e as Error).message).toContain('sales.hyper');
            expect((e as Error).message).toContain('1001');
        }
        release();
    });

    it('takes over the lock of a process that ended', () => {
        writeFileSync(lockPathOf(database), '4242\n');
        const release = acquireDatabaseLock(database, { pid: 1003, isAlive: pid => pid !== 4242 });
        expect(readFileSync(lockPathOf(database), 'utf8')).toBe('1003\n');
        release();
    });

    it('takes over a lock file without a process id', () => {
        writeFileSync(lockPathOf(database), 'garbage');
        const release = acquireDatabaseLock(database, { pid: 1004, isAlive: () => true });
        expect(readFileSync(lockPathOf(database), 'utf8')).toBe('1004\n');
        release();
    });

    it('leaves a lock alone on release that another process took over meanwhile', () => {
        const release = acquireDatabaseLock(database, { pid: 1005, isAlive: () => true });
        writeFileSync(lockPathOf(database), '1006\n');
        release();
        expect(readFileSync(lockPathOf(database), 'utf8')).toBe('1006\n');
    });

    it('releases only once', () => {
        const release = acquireDatabaseLock(database);
        release();
        const again = acquireDatabaseLock(database);
        release();
        expect(existsSync(lockPathOf(database))).toBe(true);
        again();
    });

    it('sees the test process as alive by default', () => {
        const release = acquireDatabaseLock(database);
        expect(() => acquireDatabaseLock(database)).toThrow(DatabaseInUseError);
        release();
    });
});

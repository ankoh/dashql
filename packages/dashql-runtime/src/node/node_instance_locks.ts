// The locks of the instances of the embedded Hyper in Node (platform/hyperdb/hyperdb_opfs_instance.ts). Web Locks span
// one process in Node, so the cleanup of one process would take the instance folders of the others for stale. A lock
// is a file with the id of the process that holds it, it is free once that process is gone.
import { readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import type { InstanceLocks } from '../platform/hyperdb/hyperdb_opfs_instance.js';

/// Does a process live?
function alive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        // A process of another user lives too
        return (error as { code?: string }).code === 'EPERM';
    }
}

/// The locks of the instances below a root of the host, one file per lock in a folder of the root
export function nodeInstanceLocks(folder: string): InstanceLocks {
    const fileOf = (name: string) => path.join(folder, `${name.replace(/[^\w.-]/g, '_')}.pid`);
    const holder = (name: string): number | null => {
        try {
            const pid = Number(readFileSync(fileOf(name), 'utf8').trim());
            return Number.isInteger(pid) && pid > 0 ? pid : null;
        } catch {
            return null;
        }
    };
    return {
        async hold(name) {
            mkdirSync(folder, { recursive: true });
            writeFileSync(fileOf(name), String(process.pid));
            return () => rmSync(fileOf(name), { force: true });
        },
        async whileFree(name, step) {
            const pid = holder(name);
            if (pid != null && alive(pid)) return false;
            await step();
            rmSync(fileOf(name), { force: true });
            return true;
        },
    };
}

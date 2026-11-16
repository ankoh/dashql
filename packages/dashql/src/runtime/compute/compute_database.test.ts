import { describe, expect, it, vi } from 'vitest';

import { ComputeDatabase } from './compute_database.js';
import type { EmbeddedComputeDatabase } from '../../platform/platform/database/embedded_database.js';

const DATABASE = {} as EmbeddedComputeDatabase;

describe('the compute database of a runtime', () => {
    it('is ready once the provider resolved, until a call of the provider fails', async () => {
        let fail = false;
        const database = new ComputeDatabase(async () => {
            if (fail) throw new Error('the database was handed over');
            return DATABASE;
        });
        const changed = vi.fn();
        database.subscribe(changed);
        expect(database.ready).toBe(false);
        expect(await database.get()).toBe(DATABASE);
        expect(database.ready).toBe(true);
        fail = true;
        await expect(database.get()).rejects.toThrow('handed over');
        expect(database.ready).toBe(false);
        expect(changed).toHaveBeenCalledTimes(2);
    });

    it('stops waiting for a database that never came up when the runtime shuts down', async () => {
        const database = new ComputeDatabase(() => new Promise<EmbeddedComputeDatabase>(() => { }));
        const waiting = database.get();
        database.close();
        await expect(waiting).rejects.toThrow('the runtime was destroyed');
        await expect(database.get()).rejects.toThrow('the runtime was destroyed');
    });

    it('waits for a database that came up also while the runtime shuts down', async () => {
        const database = new ComputeDatabase(async () => {
            await new Promise(resolve => setTimeout(resolve, 1));
            return DATABASE;
        });
        await database.get();
        database.close();
        expect(await database.get()).toBe(DATABASE);
    });
});

import { describe, expect, it } from 'vitest';

import { HyperDBLogSource, HyperLogUnreadableError, isHyperLogFlushTimeout, isHyperLogRotationRace } from './hyperdb_log_extract.js';
import type { HyperDBSourceConnection } from '../shared/hyperdb_incremental_extract.js';

const FLUSH_TIMEOUT = 'Timed out while flushing the structured log.';

describe('HyperDBLogSource', () => {
    it('tells the errors of a read that raced with the rotation of the log from others', () => {
        expect(isHyperLogRotationRace(new Error('could not read from external source'))).toBe(true);
        expect(isHyperLogRotationRace(new Error('invalid JSON document'))).toBe(true);
        expect(isHyperLogRotationRace(new Error(FLUSH_TIMEOUT))).toBe(false);
        expect(isHyperLogRotationRace(new Error('function hyper_log does not exist'))).toBe(false);
    });

    it('tells a read of the log that timed out from a Hyper that does not allow it', async () => {
        const failingWith = (message: string) => ({
            query: async () => { throw new Error(message); },
        }) as unknown as HyperDBSourceConnection;
        const timeout = await new HyperDBLogSource().open(failingWith(`invalid source query: ${FLUSH_TIMEOUT}`)).catch(error => error);
        expect(isHyperLogFlushTimeout(timeout)).toBe(true);
        expect(timeout).not.toBeInstanceOf(HyperLogUnreadableError);
        await expect(new HyperDBLogSource().open(failingWith('function hyper_log does not exist'))).rejects.toBeInstanceOf(HyperLogUnreadableError);
    });
});

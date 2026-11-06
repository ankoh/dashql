import type * as arrow from 'apache-arrow';
import { describe, expect, it } from 'vitest';

import { HyperDBLogSource, HyperLogUnreadableError, isHyperLogFlushTimeout } from './hyperdb_log_extract.js';
import type { HyperDBSourceConnection } from './hyperdb_incremental_extract.js';

/// A connection whose log holds the end of the clock query after a number of reads
function connectionLoggingAfter(reads: number | null, loggedAt: () => number): { connection: HyperDBSourceConnection; logReads: () => number } {
    let logReads = 0;
    const connection = {
        query: async (sql: string) => {
            let value: number | null = null;
            if (sql.includes('hyper_log(')) {
                logReads += 1;
                value = reads != null && logReads > reads ? loggedAt() : null;
            }
            return { getChild: () => ({ get: () => value }) } as unknown as arrow.Table;
        },
        execute: async () => null,
        close: async () => {},
    } as unknown as HyperDBSourceConnection;
    return { connection, logReads: () => logReads };
}

const FLUSH_TIMEOUT = 'Timed out while flushing the structured log.';

describe('HyperDBLogSource', () => {
    it('reads the clock offset from the log right away', async () => {
        const { connection, logReads } = connectionLoggingAfter(0, () => Date.now());
        expect(await new HyperDBLogSource().readClockOffset(connection)).toBe(0);
        expect(logReads()).toBe(1);
    });

    it('waits for the end of the clock query when Hyper logs it after the result', async () => {
        const offset = 2 * 60 * 60_000;
        const { connection, logReads } = connectionLoggingAfter(2, () => Date.now() + offset);
        expect(await new HyperDBLogSource().readClockOffset(connection)).toBe(offset);
        expect(logReads()).toBe(3);
    });

    it('reads the clock offset again after a read of the log timed out', async () => {
        const { connection, logReads } = connectionLoggingAfter(1, () => Date.now());
        const query = connection.query.bind(connection);
        connection.query = async (sql: string) => {
            const table = await query(sql);
            if (sql.includes('hyper_log(') && logReads() === 1) throw new Error(FLUSH_TIMEOUT);
            return table;
        };
        expect(await new HyperDBLogSource().readClockOffset(connection)).toBe(0);
        expect(logReads()).toBe(2);
    });

    it('fails on other errors of a read of the clock offset', async () => {
        const { connection, logReads } = connectionLoggingAfter(0, () => Date.now());
        const query = connection.query.bind(connection);
        connection.query = async (sql: string) => {
            const table = await query(sql);
            if (sql.includes('hyper_log(')) throw new Error('the connection was closed');
            return table;
        };
        await expect(new HyperDBLogSource().readClockOffset(connection)).rejects.toThrow('the connection was closed');
        expect(logReads()).toBe(1);
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

    it('gives up when the log never holds the end of the clock query', async () => {
        const { connection, logReads } = connectionLoggingAfter(null, () => Date.now());
        await expect(new HyperDBLogSource().readClockOffset(connection, 100))
            .rejects.toThrow('the Hyper log does not hold the end of the clock query after 100ms');
        expect(logReads()).toBeGreaterThan(1);
    });
});

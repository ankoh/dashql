// The SessionStore of the Claude Agent SDK (@anthropic-ai/claude-agent-sdk, alpha in 0.3.x) on a hot Hyper.
// The SDK mirrors every transcript entry to the store (`sessionStore` of query()) and resumes from it.

import {
    foldSessionSummary,
    type SessionKey,
    type SessionStore,
    type SessionStoreEntry,
    type SessionSummaryEntry,
} from '@anthropic-ai/claude-agent-sdk';

import { setupOnce, type HyperDatabase } from './hyper_database.js';
import { integer, json, nullableText, text, timestamp, toNumber } from './sql.js';

export interface HyperSessionStoreOptions {
    /// The prefix of the table names, `claude_` by default
    readonly tablePrefix?: string;
    /// The clock of the mtimes, Date.now by default
    readonly now?: () => number;
}


/// The transcripts of Claude Agent SDK sessions in a Hyper database.
///
/// `<prefix>session_entries` holds one row per transcript line, `entry` is the line as json, so SQL reads the
/// transcripts directly: `entry->>'type'`, `entry->'message'->'usage'`, the tool calls in `entry->'message'->'content'`.
/// `<prefix>session_summaries` holds the summary of each main transcript that the SDK folds (`foldSessionSummary`).
export class HyperSessionStore implements SessionStore {
    readonly entries: string;
    readonly summaries: string;
    private readonly now: () => number;
    private lastMtime = 0;

    constructor(
        readonly database: HyperDatabase,
        options: HyperSessionStoreOptions = {},
    ) {
        const prefix = options.tablePrefix ?? 'claude_';
        this.entries = database.table(`${prefix}session_entries`);
        this.summaries = database.table(`${prefix}session_summaries`);
        this.now = options.now ?? Date.now;
    }

    private setup(): Promise<void> {
        return setupOnce(this.database, [
            `CREATE TABLE IF NOT EXISTS ${this.entries} (
                project_key text NOT NULL,
                session_id text NOT NULL,
                subpath text NOT NULL,
                seq bigint NOT NULL,
                uuid text,
                type text NOT NULL,
                entry json NOT NULL,
                stored_at timestamptz NOT NULL
            )`,
            `CREATE TABLE IF NOT EXISTS ${this.summaries} (
                project_key text NOT NULL,
                session_id text NOT NULL,
                mtime bigint NOT NULL,
                data json NOT NULL
            )`,
        ]);
    }

    private keyCondition(key: SessionKey, alias = ''): string {
        return `${alias}project_key = ${text(key.projectKey)} AND ${alias}session_id = ${text(key.sessionId)} AND ${alias}subpath = ${text(key.subpath ?? '')}`;
    }

    /// The mtime of a write: the time of the clock, later than every mtime before, as the in-memory store of the SDK
    private nextMtime(): number {
        this.lastMtime = Math.max(Math.floor(this.now()), this.lastMtime + 1);
        return this.lastMtime;
    }

    async append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
        if (entries.length === 0) return;
        await this.setup();
        // An entry with a uuid is stored once: retries and importSessionToStore() replay entries. Entries without a
        // uuid (titles, tags, mode markers) are appended every time.
        const seen = new Set<string>();
        const fresh = entries.filter((entry) => typeof entry.uuid !== 'string' || (!seen.has(entry.uuid) && seen.add(entry.uuid) != null));
        const mtime = this.nextMtime();
        const values = fresh
            .map((entry, i) => `(${integer(i)}, ${nullableText(typeof entry.uuid === 'string' ? entry.uuid : null)}, ${text(String(entry.type))}, ${json(entry)})`)
            .join(',\n');
        await this.database.transaction(async (tx) => {
            await tx.execute(`
                INSERT INTO ${this.entries} (project_key, session_id, subpath, seq, uuid, type, entry, stored_at)
                SELECT ${text(key.projectKey)}, ${text(key.sessionId)}, ${text(key.subpath ?? '')}, next.seq + v.i, v.uuid, v.type, v.entry, ${timestamp(mtime)}
                FROM (VALUES ${values}) AS v(i, uuid, type, entry),
                     (SELECT coalesce(max(seq) + 1, 0) AS seq FROM ${this.entries} WHERE ${this.keyCondition(key)}) AS next
                WHERE v.uuid IS NULL OR NOT EXISTS (
                    SELECT 1 FROM ${this.entries} e WHERE ${this.keyCondition(key, 'e.')} AND e.uuid = v.uuid
                )`);
            // The summary of a main transcript, folded by the SDK in the same transaction as the entries
            if (key.subpath === undefined) {
                const keyCondition = `project_key = ${text(key.projectKey)} AND session_id = ${text(key.sessionId)}`;
                const rows = await tx.query(`SELECT mtime, data FROM ${this.summaries} WHERE ${keyCondition}`);
                const previous: SessionSummaryEntry | undefined =
                    rows.length > 0 ? { sessionId: key.sessionId, mtime: toNumber(rows[0].mtime), data: JSON.parse(rows[0].data as string) } : undefined;
                const summary = foldSessionSummary(previous, key, entries, { mtime });
                await tx.execute(`DELETE FROM ${this.summaries} WHERE ${keyCondition}`);
                await tx.execute(`
                    INSERT INTO ${this.summaries} (project_key, session_id, mtime, data)
                    VALUES (${text(key.projectKey)}, ${text(key.sessionId)}, ${integer(summary.mtime)}, ${json(summary.data)})`);
            }
        });
    }

    async load(key: SessionKey): Promise<SessionStoreEntry[] | null> {
        await this.setup();
        const rows = await this.database.query(`SELECT entry FROM ${this.entries} WHERE ${this.keyCondition(key)} ORDER BY seq`);
        return rows.length === 0 ? null : rows.map((row) => JSON.parse(row.entry as string) as SessionStoreEntry);
    }

    async listSessions(projectKey: string): Promise<Array<{ sessionId: string; mtime: number }>> {
        await this.setup();
        const rows = await this.database.query(`
            SELECT session_id, max(stored_at) AS mtime FROM ${this.entries}
            WHERE project_key = ${text(projectKey)} AND subpath = ''
            GROUP BY session_id`);
        return rows.map((row) => ({ sessionId: row.session_id as string, mtime: Math.floor(toNumber(row.mtime)) }));
    }

    async listSessionSummaries(projectKey: string): Promise<SessionSummaryEntry[]> {
        await this.setup();
        const rows = await this.database.query(`SELECT session_id, mtime, data FROM ${this.summaries} WHERE project_key = ${text(projectKey)}`);
        return rows.map((row) => ({ sessionId: row.session_id as string, mtime: toNumber(row.mtime), data: JSON.parse(row.data as string) }));
    }

    /// Delete a transcript. Deleting a main transcript deletes its subagent transcripts and its summary as well.
    async delete(key: SessionKey): Promise<void> {
        await this.setup();
        await this.database.transaction(async (tx) => {
            if (key.subpath === undefined) {
                const keyCondition = `project_key = ${text(key.projectKey)} AND session_id = ${text(key.sessionId)}`;
                await tx.execute(`DELETE FROM ${this.entries} WHERE ${keyCondition}`);
                await tx.execute(`DELETE FROM ${this.summaries} WHERE ${keyCondition}`);
            } else {
                await tx.execute(`DELETE FROM ${this.entries} WHERE ${this.keyCondition(key)}`);
            }
        });
    }

    async listSubkeys(key: { projectKey: string; sessionId: string }): Promise<string[]> {
        await this.setup();
        const rows = await this.database.query(`
            SELECT DISTINCT subpath FROM ${this.entries}
            WHERE project_key = ${text(key.projectKey)} AND session_id = ${text(key.sessionId)} AND subpath <> ''
            ORDER BY subpath`);
        return rows.map((row) => row.subpath as string);
    }
}

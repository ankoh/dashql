// The Session of the OpenAI Agents SDK (@openai/agents) on a hot Hyper: the conversation history that run() reads
// before a turn and appends to after it (`session` of run()).

import {
    UserError,
    type AgentInputItem,
    type SessionHistoryTransactionArgs,
    type SessionHistoryTransactionAwareSession,
} from '@openai/agents';

import { setupOnce, type HyperDatabase, type SqlRunner } from './hyper_database.js';
import { count, integer, json, text, timestamp, toNumber } from './sql.js';

export interface HyperAgentSessionOptions {
    /// The session, a random UUID by default
    readonly sessionId?: string;
    /// The prefix of the table names, `openai_` by default
    readonly tablePrefix?: string;
}


/// A JSON text with the keys of objects in order, to compare values structurally
function canonical(value: unknown): string {
    return JSON.stringify(value, (_key, inner: unknown) => {
        if (inner == null || typeof inner !== 'object' || Array.isArray(inner)) return inner;
        return Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    });
}

/// The history of one session of the OpenAI Agents SDK in a Hyper database. The sessions of a database share its
/// tables: `<prefix>session_items` holds one row per item with the item as json, `<prefix>session_operations` the
/// history transactions that ran, for their idempotency.
export class HyperAgentSession implements SessionHistoryTransactionAwareSession {
    readonly items: string;
    readonly operations: string;
    private readonly sessionId: string;

    constructor(
        readonly database: HyperDatabase,
        options: HyperAgentSessionOptions = {},
    ) {
        const prefix = options.tablePrefix ?? 'openai_';
        this.items = database.table(`${prefix}session_items`);
        this.operations = database.table(`${prefix}session_operations`);
        this.sessionId = options.sessionId ?? crypto.randomUUID();
    }

    private setup(): Promise<void> {
        return setupOnce(this.database, [
            `CREATE TABLE IF NOT EXISTS ${this.items} (
                session_id text NOT NULL,
                seq bigint NOT NULL,
                item json NOT NULL,
                added_at timestamptz NOT NULL
            )`,
            `CREATE TABLE IF NOT EXISTS ${this.operations} (
                session_id text NOT NULL,
                operation_id text NOT NULL,
                txn json NOT NULL
            )`,
        ]);
    }

    private get session(): string {
        return `session_id = ${text(this.sessionId)}`;
    }

    async getSessionId(): Promise<string> {
        return this.sessionId;
    }

    /// The items in order, or the last `limit` of them
    async getItems(limit?: number): Promise<AgentInputItem[]> {
        if (limit !== undefined && limit <= 0) return [];
        await this.setup();
        const rows =
            limit === undefined
                ? await this.database.query(`SELECT item FROM ${this.items} WHERE ${this.session} ORDER BY seq`)
                : await this.database.query(`
                    SELECT item FROM (SELECT item, seq FROM ${this.items} WHERE ${this.session} ORDER BY seq DESC LIMIT ${count(limit)}) last
                    ORDER BY seq`);
        return rows.map((row) => JSON.parse(row.item as string) as AgentInputItem);
    }

    private async append(tx: SqlRunner, items: AgentInputItem[]): Promise<void> {
        if (items.length === 0) return;
        const values = items.map((item, i) => `(${integer(i)}, ${json(item)})`).join(',\n');
        await tx.execute(`
            INSERT INTO ${this.items} (session_id, seq, item, added_at)
            SELECT ${text(this.sessionId)}, next.seq + v.i, v.item, ${timestamp(Date.now())}
            FROM (VALUES ${values}) AS v(i, item),
                 (SELECT coalesce(max(seq) + 1, 0) AS seq FROM ${this.items} WHERE ${this.session}) AS next`);
    }

    async addItems(items: AgentInputItem[]): Promise<void> {
        if (items.length === 0) return;
        await this.setup();
        await this.database.transaction((tx) => this.append(tx, items));
    }

    async popItem(): Promise<AgentInputItem | undefined> {
        await this.setup();
        return this.database.transaction(async (tx) => {
            const rows = await tx.query(`SELECT seq, item FROM ${this.items} WHERE ${this.session} ORDER BY seq DESC LIMIT 1`);
            if (rows.length === 0) return undefined;
            await tx.execute(`DELETE FROM ${this.items} WHERE ${this.session} AND seq = ${integer(toNumber(rows[0].seq))}`);
            return JSON.parse(rows[0].item as string) as AgentInputItem;
        });
    }

    async clearSession(): Promise<void> {
        await this.setup();
        await this.database.transaction(async (tx) => {
            await tx.execute(`DELETE FROM ${this.items} WHERE ${this.session}`);
            await tx.execute(`DELETE FROM ${this.operations} WHERE ${this.session}`);
        });
    }

    /// Append items or replace the last ones, atomically and once per operation id
    async applyHistoryTransaction(args: SessionHistoryTransactionArgs): Promise<void> {
        const { operationId, transaction } = args ?? ({} as SessionHistoryTransactionArgs);
        if (typeof operationId !== 'string' || !operationId.trim()) {
            throw new UserError('Session history transaction operationId must be a non-empty string.');
        }
        if (transaction == null || (transaction.type !== 'append_items' && transaction.type !== 'replace_suffix')) {
            throw new UserError('Session history transaction must be an append_items or replace_suffix transaction.');
        }
        await this.setup();
        await this.database.transaction(async (tx) => {
            const operation = `${this.session} AND operation_id = ${text(operationId)}`;
            const applied = await tx.query(`SELECT txn FROM ${this.operations} WHERE ${operation}`);
            if (applied.length > 0) {
                if (canonical(JSON.parse(applied[0].txn as string)) !== canonical(transaction)) {
                    throw new UserError('Session history operation was already applied with a different transaction.');
                }
                return;
            }
            if (transaction.type === 'append_items') {
                await this.append(tx, transaction.items);
            } else {
                const { expectedSuffix, replacement } = transaction;
                const suffix =
                    expectedSuffix.length === 0
                        ? []
                        : await tx.query(`SELECT seq, item FROM ${this.items} WHERE ${this.session} ORDER BY seq DESC LIMIT ${count(expectedSuffix.length)}`);
                const actual = suffix.reverse().map((row) => JSON.parse(row.item as string) as unknown);
                if (actual.length !== expectedSuffix.length || canonical(actual) !== canonical(expectedSuffix)) {
                    throw new UserError('Session history suffix no longer matches the transaction precondition.');
                }
                if (suffix.length > 0) {
                    await tx.execute(`DELETE FROM ${this.items} WHERE ${this.session} AND seq >= ${integer(toNumber(suffix[0].seq))}`);
                }
                await this.append(tx, replacement);
            }
            await tx.execute(`INSERT INTO ${this.operations} (session_id, operation_id, txn) VALUES (${text(this.sessionId)}, ${text(operationId)}, ${json(transaction)})`);
        });
    }
}

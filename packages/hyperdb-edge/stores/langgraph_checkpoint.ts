// The checkpointer of LangGraph.js (@langchain/langgraph) on a hot Hyper: the state of every superstep of a thread,
// for resuming, time travel and human in the loop. The tables follow the Postgres saver of
// @langchain/langgraph-checkpoint-postgres: a channel value is stored once per version, not with every checkpoint.

import type { RunnableConfig } from '@langchain/core/runnables';
import {
    BaseCheckpointSaver,
    TASKS,
    WRITES_IDX_MAP,
    compareWritesSortKeys,
    copyCheckpoint,
    maxChannelVersion,
    writesSortKey,
    type ChannelVersions,
    type Checkpoint,
    type CheckpointListOptions,
    type CheckpointMetadata,
    type CheckpointPendingWrite,
    type CheckpointTuple,
    type PendingWrite,
    type SerializerProtocol,
} from '@langchain/langgraph-checkpoint';

import { setupOnce, type HyperDatabase, type Row } from './hyper_database.js';
import { bytes, canonical, count, integer, nullableText, text, timestamp } from './sql.js';

export interface HyperCheckpointSaverOptions {
    /// The prefix of the table names, `langgraph_` by default
    readonly tablePrefix?: string;
    readonly serde?: SerializerProtocol;
}

/// The type of a blob of a channel that had no value at its version
const EMPTY = 'empty';

/// The JSON text of serialized metadata, for SQL over the metadata, or null when the serializer wrote no JSON
function metadataJson(type: string, serialized: Uint8Array): string | null {
    if (type !== 'json') return null;
    const decoded = new TextDecoder().decode(serialized);
    try {
        JSON.parse(decoded);
        return decoded;
    } catch {
        return null;
    }
}

/// Writes in the order live execution applies them: by task path, task id and index
function sortWrites(writes: Row[]): Row[] {
    return writes
        .map((write) => ({ write, key: writesSortKey(write.task_path as string, write.task_id as string, Number(write.idx)) }))
        .sort((a, b) => compareWritesSortKeys(a.key, b.key))
        .map(({ write }) => write);
}

/// The key of a checkpoint in maps
function checkpointKey(row: Row): string {
    return `${row.thread_id}\0${row.checkpoint_ns}\0${row.checkpoint_id}`;
}

/// The checkpoints of LangGraph threads in a Hyper database.
///
/// `<prefix>checkpoints` holds a checkpoint per superstep without its channel values, and its metadata also as json
/// (`metadata_json`: source, step and the metadata of the run), so SQL reads the runs of every thread.
/// `<prefix>checkpoint_blobs` holds the value of a channel per version, `<prefix>checkpoint_writes` the pending
/// writes of the tasks.
export class HyperCheckpointSaver extends BaseCheckpointSaver {
    readonly checkpoints: string;
    readonly blobs: string;
    readonly writes: string;

    constructor(
        readonly database: HyperDatabase,
        options: HyperCheckpointSaverOptions = {},
    ) {
        super(options.serde);
        const prefix = options.tablePrefix ?? 'langgraph_';
        this.checkpoints = database.table(`${prefix}checkpoints`);
        this.blobs = database.table(`${prefix}checkpoint_blobs`);
        this.writes = database.table(`${prefix}checkpoint_writes`);
    }

    private setup(): Promise<void> {
        return setupOnce(this.database, [
            `CREATE TABLE IF NOT EXISTS ${this.checkpoints} (
                thread_id text NOT NULL,
                checkpoint_ns text NOT NULL,
                checkpoint_id text NOT NULL,
                parent_checkpoint_id text,
                type text NOT NULL,
                checkpoint bytea NOT NULL,
                metadata bytea NOT NULL,
                metadata_json json,
                created_at timestamptz NOT NULL
            )`,
            `CREATE TABLE IF NOT EXISTS ${this.blobs} (
                thread_id text NOT NULL,
                checkpoint_ns text NOT NULL,
                channel text NOT NULL,
                version text NOT NULL,
                type text NOT NULL,
                blob bytea
            )`,
            `CREATE TABLE IF NOT EXISTS ${this.writes} (
                thread_id text NOT NULL,
                checkpoint_ns text NOT NULL,
                checkpoint_id text NOT NULL,
                task_id text NOT NULL,
                task_path text NOT NULL,
                idx bigint NOT NULL,
                channel text NOT NULL,
                type text NOT NULL,
                value bytea NOT NULL
            )`,
        ]);
    }

    /// The tuples of checkpoint rows, with three queries for all of them: the writes, the blobs and the sends of
    /// checkpoints before format 4
    private async tuples(rows: Row[]): Promise<CheckpointTuple[]> {
        if (rows.length === 0) return [];
        const checkpoints = await Promise.all(rows.map((row) => this.serde.loadsTyped(row.type as string, row.checkpoint as Uint8Array) as Promise<Checkpoint>));

        // The pending writes of the checkpoints, and the sends of the parents of old checkpoints
        const keys = new Map<string, string>();
        const addKey = (thread: unknown, ns: unknown, id: unknown) =>
            keys.set(`${thread}\0${ns}\0${id}`, `(${text(thread as string)}, ${text(ns as string)}, ${text(id as string)})`);
        rows.forEach((row, i) => {
            addKey(row.thread_id, row.checkpoint_ns, row.checkpoint_id);
            if (checkpoints[i].v < 4 && row.parent_checkpoint_id != null) addKey(row.thread_id, row.checkpoint_ns, row.parent_checkpoint_id);
        });
        const writes = await this.database.query(`
            SELECT w.thread_id, w.checkpoint_ns, w.checkpoint_id, w.task_id, w.task_path, w.idx, w.channel, w.type, w.value
            FROM ${this.writes} w
            JOIN (VALUES ${[...keys.values()].join(', ')}) AS k(thread_id, checkpoint_ns, checkpoint_id)
              ON w.thread_id = k.thread_id AND w.checkpoint_ns = k.checkpoint_ns AND w.checkpoint_id = k.checkpoint_id`);
        const writesOf = new Map<string, Row[]>();
        for (const write of writes) writesOf.set(checkpointKey(write), [...(writesOf.get(checkpointKey(write)) ?? []), write]);

        // The channel values at the versions of the checkpoints
        const versions = new Map<string, string>();
        rows.forEach((row, i) => {
            for (const [channel, version] of Object.entries(checkpoints[i].channel_versions ?? {})) {
                const literal = `(${text(row.thread_id as string)}, ${text(row.checkpoint_ns as string)}, ${text(channel)}, ${text(String(version))})`;
                versions.set(`${row.thread_id}\0${row.checkpoint_ns}\0${channel}\0${version}`, literal);
            }
        });
        const blobs =
            versions.size === 0
                ? []
                : await this.database.query(`
                    SELECT b.thread_id, b.checkpoint_ns, b.channel, b.version, b.type, b.blob
                    FROM ${this.blobs} b
                    JOIN (VALUES ${[...versions.values()].join(', ')}) AS k(thread_id, checkpoint_ns, channel, version)
                      ON b.thread_id = k.thread_id AND b.checkpoint_ns = k.checkpoint_ns AND b.channel = k.channel AND b.version = k.version
                    WHERE b.type <> ${text(EMPTY)}`);
        const blobOf = new Map(blobs.map((blob) => [`${blob.thread_id}\0${blob.checkpoint_ns}\0${blob.channel}\0${blob.version}`, blob]));

        return Promise.all(
            rows.map(async (row, i): Promise<CheckpointTuple> => {
                const checkpoint = checkpoints[i];
                const thread_id = row.thread_id as string;
                const checkpoint_ns = row.checkpoint_ns as string;
                checkpoint.channel_values ??= {};
                for (const [channel, version] of Object.entries(checkpoint.channel_versions ?? {})) {
                    const blob = blobOf.get(`${thread_id}\0${checkpoint_ns}\0${channel}\0${version}`);
                    if (blob != null) checkpoint.channel_values[channel] = await this.serde.loadsTyped(blob.type as string, blob.blob as Uint8Array);
                }
                if (checkpoint.v < 4 && row.parent_checkpoint_id != null) {
                    const sends = sortWrites(writesOf.get(`${thread_id}\0${checkpoint_ns}\0${row.parent_checkpoint_id}`) ?? []).filter((w) => w.channel === TASKS);
                    checkpoint.channel_values[TASKS] = await Promise.all(sends.map((send) => this.serde.loadsTyped(send.type as string, send.value as Uint8Array)));
                    checkpoint.channel_versions[TASKS] =
                        Object.keys(checkpoint.channel_versions).length > 0
                            ? maxChannelVersion(...Object.values(checkpoint.channel_versions))
                            : this.getNextVersion(undefined);
                }
                const pendingWrites = await Promise.all(
                    sortWrites(writesOf.get(checkpointKey(row)) ?? []).map(
                        async (write): Promise<CheckpointPendingWrite> => [
                            write.task_id as string,
                            write.channel as string,
                            await this.serde.loadsTyped(write.type as string, write.value as Uint8Array),
                        ],
                    ),
                );
                return {
                    config: { configurable: { thread_id, checkpoint_ns, checkpoint_id: row.checkpoint_id as string } },
                    checkpoint,
                    metadata: (await this.serde.loadsTyped(row.type as string, row.metadata as Uint8Array)) as CheckpointMetadata,
                    parentConfig:
                        row.parent_checkpoint_id != null
                            ? { configurable: { thread_id, checkpoint_ns, checkpoint_id: row.parent_checkpoint_id as string } }
                            : undefined,
                    pendingWrites,
                };
            }),
        );
    }

    /// A version unique across the branches of a thread, as the Postgres saver makes them: the counter, zero-padded so
    /// that versions order as texts, and a random part. A fork counts up from the versions of the checkpoint it starts
    /// at, so with counters alone the blobs of two branches would take the same keys.
    override getNextVersion(current: number | undefined): number {
        const counter = current === undefined ? 0 : Number(String(current).split('.')[0]);
        const random = Math.floor(Math.random() * 1e16).toString().padStart(16, '0');
        // The type of the base class says number, the channels take any version that orders
        return `${String(counter + 1).padStart(32, '0')}.${random}` as unknown as number;
    }

    async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
        await this.setup();
        const { thread_id, checkpoint_ns = '', checkpoint_id } = config.configurable ?? {};
        if (thread_id == null) return undefined;
        const rows = await this.database.query(`
            SELECT thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata
            FROM ${this.checkpoints}
            WHERE thread_id = ${text(String(thread_id))} AND checkpoint_ns = ${text(checkpoint_ns)}
              ${checkpoint_id ? `AND checkpoint_id = ${text(checkpoint_id)}` : ''}
            ORDER BY checkpoint_id DESC LIMIT 1`);
        return (await this.tuples(rows))[0];
    }

    async *list(config: RunnableConfig, options?: CheckpointListOptions): AsyncGenerator<CheckpointTuple> {
        await this.setup();
        const { limit, before, filter } = options ?? {};
        const thread_id = config.configurable?.thread_id;
        const checkpoint_ns = config.configurable?.checkpoint_ns;
        const conditions: string[] = [];
        if (thread_id) conditions.push(`thread_id = ${text(String(thread_id))}`);
        if (checkpoint_ns !== undefined && checkpoint_ns !== null) conditions.push(`checkpoint_ns = ${text(checkpoint_ns)}`);
        if (before?.configurable?.checkpoint_id !== undefined) conditions.push(`checkpoint_id < ${text(before.configurable.checkpoint_id)}`);
        const filters = Object.entries(filter ?? {}).filter(([, value]) => value !== undefined);
        // The filter compares deserialized metadata, so the limit applies after it
        const rows = await this.database.query(`
            SELECT thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata
            FROM ${this.checkpoints}
            ${conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''}
            ORDER BY checkpoint_id DESC
            ${limit && filters.length === 0 ? `LIMIT ${count(Math.floor(limit))}` : ''}`);
        const kept: Row[] = [];
        for (const row of rows) {
            if (limit && kept.length >= limit) break;
            if (filters.length > 0) {
                const metadata = (await this.serde.loadsTyped(row.type as string, row.metadata as Uint8Array)) as Record<string, unknown>;
                if (!filters.every(([key, value]) => canonical(metadata?.[key]) === canonical(value))) continue;
            }
            kept.push(row);
        }
        yield* await this.tuples(kept);
    }

    async put(config: RunnableConfig, checkpoint: Checkpoint, metadata: CheckpointMetadata, newVersions: ChannelVersions): Promise<RunnableConfig> {
        await this.setup();
        if (!config.configurable) throw new Error('Empty configuration supplied.');
        const thread_id = config.configurable.thread_id;
        const checkpoint_ns = config.configurable.checkpoint_ns ?? '';
        const parent_checkpoint_id = config.configurable.checkpoint_id;
        if (!thread_id) throw new Error(`Missing "thread_id" field in passed "config.configurable".`);

        // The values of the channels that changed go to the blobs, the checkpoint keeps none
        const copy = copyCheckpoint(checkpoint);
        const values = copy.channel_values ?? {};
        copy.channel_values = {};
        const blobs = await Promise.all(
            Object.entries(newVersions).map(async ([channel, version]) => {
                const [type, serialized] = channel in values ? await this.serde.dumpsTyped(values[channel]) : [EMPTY, null];
                return `(${text(channel)}, ${text(String(version))}, ${text(type)}, ${serialized == null ? 'CAST(NULL AS bytea)' : bytes(serialized)})`;
            }),
        );
        const [[type, serializedCheckpoint], [metadataType, serializedMetadata]] = await Promise.all([this.serde.dumpsTyped(copy), this.serde.dumpsTyped(metadata)]);
        if (type !== metadataType) throw new Error('Failed to serialized checkpoint and metadata to the same type.');
        const json = metadataJson(type, serializedMetadata);
        const thread = text(String(thread_id));
        const ns = text(checkpoint_ns);
        await this.database.transaction(async (tx) => {
            if (blobs.length > 0) {
                await tx.execute(`
                    INSERT INTO ${this.blobs} (thread_id, checkpoint_ns, channel, version, type, blob)
                    SELECT ${thread}, ${ns}, v.channel, v.version, v.type, v.blob
                    FROM (VALUES ${blobs.join(',\n')}) AS v(channel, version, type, blob)
                    WHERE NOT EXISTS (
                        SELECT 1 FROM ${this.blobs} b
                        WHERE b.thread_id = ${thread} AND b.checkpoint_ns = ${ns} AND b.channel = v.channel AND b.version = v.version
                    )`);
            }
            await tx.execute(`DELETE FROM ${this.checkpoints} WHERE thread_id = ${thread} AND checkpoint_ns = ${ns} AND checkpoint_id = ${text(checkpoint.id)}`);
            await tx.execute(`
                INSERT INTO ${this.checkpoints}
                    (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata, metadata_json, created_at)
                VALUES (${thread}, ${ns}, ${text(checkpoint.id)}, ${nullableText(parent_checkpoint_id)},
                    ${text(type)}, ${bytes(serializedCheckpoint)}, ${bytes(serializedMetadata)},
                    ${json == null ? 'CAST(NULL AS json)' : `CAST(${text(json)} AS json)`}, ${timestamp(Date.now())})`);
        });
        return { configurable: { thread_id, checkpoint_ns, checkpoint_id: checkpoint.id } };
    }

    async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string, taskPath?: string): Promise<void> {
        await this.setup();
        if (!config.configurable) throw new Error('Empty configuration supplied.');
        if (!config.configurable.thread_id) throw new Error('Missing thread_id field in config.configurable.');
        if (!config.configurable.checkpoint_id) throw new Error('Missing checkpoint_id field in config.configurable.');
        if (writes.length === 0) return;
        const thread_id = text(String(config.configurable.thread_id));
        const checkpoint_ns = text(config.configurable.checkpoint_ns ?? '');
        const checkpoint_id = text(config.configurable.checkpoint_id);
        // Writes to the special channels (errors, interrupts, …) replace the ones of the same index, others are kept
        const allSpecial = writes.every(([channel]) => channel in WRITES_IDX_MAP);
        const rows = await Promise.all(
            writes.map(async ([channel, value], i) => {
                const [type, serialized] = await this.serde.dumpsTyped(value);
                const idx = WRITES_IDX_MAP[channel] ?? i;
                return `(${integer(idx)}, ${text(channel)}, ${text(type)}, ${bytes(serialized)})`;
            }),
        );
        const task = (alias: string) =>
            `${alias}thread_id = ${thread_id} AND ${alias}checkpoint_ns = ${checkpoint_ns} AND ${alias}checkpoint_id = ${checkpoint_id} AND ${alias}task_id = ${text(taskId)}`;
        await this.database.transaction(async (tx) => {
            if (allSpecial) {
                await tx.execute(`DELETE FROM ${this.writes} WHERE ${task('')} AND idx IN (${writes.map(([channel], i) => integer(WRITES_IDX_MAP[channel] ?? i)).join(', ')})`);
            }
            await tx.execute(`
                INSERT INTO ${this.writes} (thread_id, checkpoint_ns, checkpoint_id, task_id, task_path, idx, channel, type, value)
                SELECT ${thread_id}, ${checkpoint_ns}, ${checkpoint_id}, ${text(taskId)}, ${text(taskPath ?? '')}, v.idx, v.channel, v.type, v.value
                FROM (VALUES ${rows.join(',\n')}) AS v(idx, channel, type, value)
                WHERE NOT EXISTS (SELECT 1 FROM ${this.writes} w WHERE ${task('w.')} AND w.idx = v.idx)`);
        });
    }

    async deleteThread(threadId: string): Promise<void> {
        await this.setup();
        await this.database.transaction(async (tx) => {
            await tx.execute(`DELETE FROM ${this.checkpoints} WHERE thread_id = ${text(threadId)}`);
            await tx.execute(`DELETE FROM ${this.blobs} WHERE thread_id = ${text(threadId)}`);
            await tx.execute(`DELETE FROM ${this.writes} WHERE thread_id = ${text(threadId)}`);
        });
    }
}

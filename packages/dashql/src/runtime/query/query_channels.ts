import * as arrow from 'apache-arrow';
import type * as core from '../../core/index.js';
import * as perfMarks from '../../core/perf_marks.js';

import type { QueryExecutionArgs } from '../../platform/connections/query_execution_args.js';
import type { HyperDatabaseChannel } from '../../platform/connections/hyper/hyperdb_grpc_client.js';
import type { HandleTable } from '../store/handles.js';
import type { CachePins } from './cache_pins.js';
import type { PlatformTables } from '../store/runtime_tables.js';
import type { WorkbookResultFiles } from '../../platform/workbook/workbook_result_files.js';
import type { QueryExecutionResponseStream, QueryStreamItem } from '../../platform/query/query_execution_state.js';
import { createTrace } from '../../platform/logger/trace_context.js';
import { LoggableException, type Logger } from '../../platform/logger/logger.js';
import type { LogRecord } from '../../platform/logger/log_buffer.js';
import type { EmbeddedComputeDatabase } from '../../platform/embedded_database.js';

/// The compute database of the platform, it resolves once the platform set it up
type ComputeDatabase = () => Promise<EmbeddedComputeDatabase>;

/// What the platform keeps of a query of a channel: the channel of its connection, its stream and its cancellation.
/// The runtime describes the query first (`describe`), which creates the record, and forgets it when its run ends
/// (`forget`), which deletes it.
interface QueryRecord {
    /// The query on the channel as the runtime described it, null until then
    query: core.RuntimeChannelQuery | null;
    /// The channel of the connection
    channel: unknown;
    /// Aborted by a cancel of the runtime, it stops a query that the channel still opens and the stream of the channel
    cancellation: AbortController;
    /// The stream of a channel of the host and its messages
    stream: QueryExecutionResponseStream | null;
    /// The cancellation of the stream at the backend, every cancel waits for the same one
    streamCancel: Promise<void> | null;
    /// The items of the stream, from the first message on
    items: AsyncIterator<QueryStreamItem> | null;
    /// The batches that went into the table
    batches: number;
    /// The table that the batches of the stream go into
    table: number | null;
    /// When the channel opened the query, while the perf marks record
    started: number | null;
}

function newRecord(): QueryRecord {
    return {
        query: null,
        channel: null,
        cancellation: new AbortController(),
        stream: null,
        streamCancel: null,
        items: null,
        batches: 0,
        table: null,
        started: null,
    };
}

/// The query of a span of the perf marks: its id and the start of its text
function queryLabel(queryId: number, query: core.RuntimeChannelQuery | null): string {
    const text = (query?.text ?? '').replace(/\s+/g, ' ').trim();
    return `#${queryId} ${text.length > 80 ? `${text.substring(0, 80)}…` : text}`;
}

/// The cancellation of a query as an error
function abortError(): DOMException {
    return new DOMException('Query was cancelled', 'AbortError');
}

/// What the channels and the cache need of the platform
export interface QueryChannelsDependencies {
    logger: Logger;
    handles: HandleTable;
    tables: PlatformTables;
    /// The database of the computations, null without one
    computeDatabase: ComputeDatabase | null;
    /// The stored results of the scripts of the workbooks, null without
    results: WorkbookResultFiles | null;
    /// The files of the results that the runtime keeps
    pins: CachePins;
}

/// The half of the queries of the runtime that touches the objects of the platform (docs/design/dashql_runtime.md). The
/// runtime describes a query itself: the target on the channel of its connection, the key of its result and what the
/// executor does around it; the connections own the channels that the runtime speaks (Trino, Hyper over HTTP, the
/// Hyper of Salesforce) with their tokens. This class keeps the channel of the host of a query, runs the queries of the
/// channels of the host (the gRPC channel of Hyper, the embedded Hyper, the channels of tests), keeps the stored
/// results of the scripts over the compute database, and gives a caller in TypeScript the result table and the error
/// of a failed query.
export class QueryChannels {
    private readonly records = new Map<number, QueryRecord>();

    /// The stored results of the scripts, Parquet files that the compute database reads and writes. Null without
    /// stored results or without a compute database.
    readonly results: core.RuntimeResults | null;

    constructor(private readonly deps: QueryChannelsDependencies) {
        this.results = deps.results == null || deps.computeDatabase == null ? null : this.createResults(deps.results, deps.computeDatabase);
    }

    /// Let go of what the platform keeps for the runtime: the queries stop
    dispose(): void {
        for (const record of this.records.values()) record.cancellation.abort(abortError());
        this.records.clear();
    }

    /// The channels of the platform by query
    readonly channels: Pick<core.RuntimeChannels, 'describe' | 'forget' | 'open' | 'next' | 'cancel'> = {
        describe: async (queryId, handle, query) => {
            // The runtime describes only the channels of the host, the platform keeps the channel for the query
            const record = newRecord();
            this.records.set(queryId, record);
            record.query = query;
            record.channel = this.deps.handles.get(handle) ?? null;
            return { type: 'host' };
        },
        forget: queryId => {
            const record = this.records.get(queryId);
            this.records.delete(queryId);
            // A stream that was not read to the end stops
            void record?.items?.return?.()?.catch(() => { });
        },
        open: async (queryId, table) => {
            const record = this.recordOf(queryId);
            const query = record.query;
            if (query == null) throw new Error(`The query ${queryId} was not described`);
            const channel = record.channel as HyperDatabaseChannel | null;
            if (channel == null) throw new Error(`${query.connector} is not connected, connect it to run the query`);
            record.started = perfMarks.start();
            const stream = await perfMarks.measure(
                'query:open',
                () => channel.executeQuery(query.text, record.cancellation.signal, { readTimeoutMs: query.readTimeoutMs ?? undefined }),
                () => queryLabel(queryId, query),
            );
            if (stream == null) return false;
            record.stream = stream;
            // The stream is read from the first message on, a query that was cancelled meanwhile never reads it
            record.table = table;
            return true;
        },
        next: queryId => this.nextMessage(queryId, this.recordOf(queryId)),
        cancel: async queryId => {
            const record = this.records.get(queryId);
            if (record == null) return;
            record.cancellation.abort(abortError());
            // A stream is cancelled once at the backend, every cancel waits for it
            if (record.stream != null) {
                record.streamCancel ??= Promise.resolve(record.stream.cancel?.());
                await record.streamCancel;
            }
        },
    };

    /// The stored results of the scripts over the compute database. The platform only moves the files, the runtime
    /// names them and decides (docs/design/workbook_results.md).
    private createResults(files: WorkbookResultFiles, database: ComputeDatabase): core.RuntimeResults {
        const { handles, pins } = this.deps;
        return {
            mount: workbookId => perfMarks.measure('results:mount', async () => await files.mount(await database(), workbookId), workbookId),
            unmount: workbookId => files.unmount(workbookId),
            files: workbookId => files.files(workbookId),
            pin: async (workbookId, name) => pins.add(await files.pin(workbookId, name)),
            release: id => pins.release(id),
            read: (workbookId, name) => perfMarks.measure('results:read', async () => {
                const table = await files.readTable(await database(), workbookId, name);
                if (table == null) return null;
                return { table: handles.register(table), rows: table.numRows, columns: table.numCols } satisfies core.RuntimeCachedTable;
            }, name),
            write: (workbookId, name, handle) => {
                // The table is taken when the runtime calls, its handle may go before the write ends
                const table = handles.get<arrow.Table>(handle);
                return perfMarks.measure('results:write', async () => {
                    if (table == null) throw new Error('The query has no result');
                    return await files.writeTable(await database(), workbookId, table, name);
                }, name);
            },
            file: (workbookId, name) => files.readFile(workbookId, name),
            import: (workbookId, name, handle, crc32) => perfMarks.measure('results:import', async () => {
                const file = handles.get<Blob | Uint8Array>(handle);
                if (file == null) throw new Error(`The result ${name} has no file`);
                // The bytes are streamed into the file, a slice of a dropped archive never sits in memory
                const blob = file instanceof Blob ? file : new Blob([file as Uint8Array<ArrayBuffer>]);
                await files.importFile(workbookId, name, blob, { crc32: crc32 ?? undefined });
            }, name),
            move: (workbookId, from, to) => files.move(workbookId, from, to),
            remove: (workbookId, name) => files.remove(workbookId, name),
        };
    }

    /// Run a query on a connection of the runtime: the runtime registers it in the history of the connection right
    /// away, describes and runs it. Returns the id and the result table, null for a query without one.
    execute(runtime: core.Runtime, connectionId: string, args: QueryExecutionArgs): [number, Promise<arrow.Table | null>] {
        const { logger } = this.deps;
        const trace = createTrace();
        const ticket = runtime.executeQuery(
            connectionId,
            {
                text: args.query,
                metadata: args.metadata,
                traceId: trace.traceId,
                spanId: trace.spanId,
                options: {
                    analyzeResults: args.analyzeResults,
                    throwOnError: true,
                    clientFunctionCall: args.clientFunctionCall,
                },
            },
            undefined,
            event => {
                try {
                    if (event.type === 'timing') args.onTiming?.(event.label, event.elapsedMs);
                } catch {
                    // An observer must not interrupt the query
                }
            },
        );
        const queryId = ticket.queryId;
        // An abort of the caller cancels the query in the runtime, the runtime cancels the channel
        const cancelFromCaller = () => {
            void runtime.cancelQuery(queryId).catch(() => { });
        };
        if (args.abortSignal?.aborted) {
            cancelFromCaller();
        } else {
            args.abortSignal?.addEventListener('abort', cancelFromCaller, { once: true });
        }
        const logObserver = args.onLog == null ? null : (entry: LogRecord) => {
            try {
                args.onLog?.(entry.message);
            } catch {
                // A progress surface must never interrupt query execution or logger delivery
            }
        };
        if (logObserver != null) logger.buffer.subscribeTrace(trace.traceId, logObserver);
        const execution = ticket.done.then(outcome => {
            if (outcome.status === 'resolved') return outcome.hasResult ? outcome.table as arrow.Table : null;
            throw this.errorOf(args, outcome.failure, outcome.value);
        }).finally(() => {
            args.abortSignal?.removeEventListener('abort', cancelFromCaller);
            if (logObserver != null) logger.buffer.unsubscribeTrace(trace.traceId, logObserver);
        });
        return [queryId, execution];
    }

    /// The error of a failure. What the host failed with stays, the cancellation of the caller is its reason.
    private errorOf(args: QueryExecutionArgs, failure: core.QueryRunFailure, value: unknown): unknown {
        if (failure.hostValue) return value;
        if (failure.kind === 'cancelled') return args.abortSignal?.reason ?? abortError();
        return new LoggableException(failure.message, failure.details, failure.target);
    }

    /// A query of a record
    private recordOf(queryId: number): QueryRecord {
        const record = this.records.get(queryId);
        if (record == null) throw new Error(`Unknown query ${queryId}`);
        return record;
    }

    /// The next message of a channel: the next batch that goes into the table of the query, the next progress, or the
    /// end of the stream. The runtime pulls a message when it handled the last one, the stream is read as fast.
    private async nextMessage(queryId: number, record: QueryRecord): Promise<core.RuntimeChannelMessage> {
        const stream = record.stream;
        if (stream == null || record.table == null) throw new Error('The query has no stream');
        const publish = record.query?.publishResults !== false;
        const result = this.deps.tables.stream(record.table);
        record.items ??= stream.read(record.cancellation.signal)[Symbol.asyncIterator]();
        for (;;) {
            const next = await record.items.next();
            if (next.done) {
                if (publish && record.batches === 0) {
                    result?.setSchema(await stream.getSchema() ?? new arrow.Schema());
                }
                perfMarks.end('query:run', record.started, () => `${queryLabel(queryId, record.query)} (${record.batches} batches)`);
                record.started = null;
                return { type: 'end', metrics: stream.getMetrics() };
            }
            const item = next.value;
            if (item.type === 'progress') return { type: 'progress', progress: item.progress as core.QueryProgressView };
            // An unpublished result keeps no batches
            if (!publish) continue;
            ++record.batches;
            // The batch stays here, the executor follows the metrics
            result?.pushBatch(item.batch);
            return { type: 'batch', metrics: stream.getMetrics() };
        }
    }
}

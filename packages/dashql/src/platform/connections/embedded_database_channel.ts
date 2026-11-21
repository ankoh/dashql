import type * as arrow from 'apache-arrow';
import type * as core from '../../core/index.js';
import type * as pb from '../proto.js';

import type { EmbeddedClientContext, EmbeddedComputeDatabase, EmbeddedConnection, EmbeddedResultStream } from '../embedded_database.js';
import { embeddedAttachedDatabasePath } from '../hyperdb/hyperdb_opfs_instance.js';
import {
    createQueryResponseStreamMetrics,
    type QueryExecutionMetrics,
    type QueryExecutionResponseStream,
    type QueryStreamItem,
} from '../query/query_execution_state.js';
import type { HyperDatabaseChannel } from './hyper/hyperdb_grpc_client.js';
import { yieldToBrowser } from '../utils/yield_to_browser.js';

const STREAM_YIELD_INTERVAL = 8;

/// A query result that streams the record batches as the embedded database produces them.
class EmbeddedQueryResultStream implements QueryExecutionResponseStream {
    private readonly metrics: QueryExecutionMetrics;
    /// Resolves once the result is read to the end or cancelled, the connection is free again then
    readonly finished: Promise<void>;
    private resolveFinished!: () => void;

    constructor(
        /// The result batches
        private readonly reader: EmbeddedResultStream,
        /// The time at which the query was started
        private readonly startedAt: number,
    ) {
        this.metrics = createQueryResponseStreamMetrics();
        this.metrics.totalQueryRequestsStarted = 1;
        this.finished = new Promise(resolve => { this.resolveFinished = resolve; });
    }

    async cancel(): Promise<void> {
        try {
            await this.reader.cancel();
        } finally {
            this.resolveFinished();
        }
    }


    getMetrics(): QueryExecutionMetrics {
        return this.metrics;
    }


    async getSchema(): Promise<arrow.Schema> {
        return this.reader.schema;
    }

    /// The batches as the database produces them, the abort signal of the query cancels it in the database
    async *read(abort?: AbortSignal): AsyncGenerator<QueryStreamItem> {
        try {
            for (;;) {
                abort?.throwIfAborted();
                const next = await this.reader.next();
                if (next.done) break;
                const batch = next.value;
                this.metrics.durationUntilFirstBatchMs ??= performance.now() - this.startedAt;
                this.metrics.totalDataBytesReceived += batch.data.byteLength;
                this.metrics.totalBatchesReceived += 1;
                this.metrics.totalRowsReceived += batch.numRows;
                yield { type: 'batch', batch };
                if (this.metrics.totalBatchesReceived % STREAM_YIELD_INTERVAL === 0) await yieldToBrowser();
            }
            this.metrics.totalQueryRequestsSucceeded = 1;
        } catch (error) {
            this.metrics.totalQueryRequestsFailed = 1;
            // Stop the query when the batches are not read to the end
            await this.reader.cancel().catch(() => {});
            throw error;
        } finally {
            // A reader that stops early returns the generator, the query is cancelled then
            if (this.metrics.totalQueryRequestsSucceeded === 0 && this.metrics.totalQueryRequestsFailed === 0) {
                this.metrics.totalQueryRequestsFailed = 1;
                await this.reader.cancel().catch(() => {});
            }
            this.metrics.totalQueryRequestDurationMs = performance.now() - this.startedAt;
            this.resolveFinished();
        }
    }
}

/// Wait for a promise, an abort rejects right away
function waitUnlessAborted(promise: Promise<void>, abort?: AbortSignal): Promise<void> {
    if (abort == null) return promise;
    return new Promise((resolve, reject) => {
        const onAbort = () => reject(abort.reason);
        abort.addEventListener('abort', onAbort, { once: true });
        void promise.then(() => {
            abort.removeEventListener('abort', onAbort);
            resolve();
        });
    });
}

export class EmbeddedDatabaseChannel {
    /// The connection runs one statement at a time, so queries wait until the result of the previous one is read.
    /// One connection keeps the workbook state of the scripts, such as settings and attached databases.
    private previousQuery: Promise<void> = Promise.resolve();

    constructor(private readonly connection: Pick<EmbeddedConnection, 'queryStream' | 'close'>) {}

    /// Wait for the turn of a query, returns what ends it. The next query waits for this one as well, this query may be
    /// cancelled while it waits.
    private async turn(abort?: AbortSignal): Promise<() => void> {
        abort?.throwIfAborted();
        const previous = this.previousQuery;
        let release!: () => void;
        const finished = new Promise<void>(resolve => { release = resolve; });
        this.previousQuery = previous.then(() => finished);
        try {
            await waitUnlessAborted(previous, abort);
            abort?.throwIfAborted();
            return release;
        } catch (error) {
            release();
            throw error;
        }
    }

    async executeQuery(query: string, abort?: AbortSignal): Promise<QueryExecutionResponseStream> {
        const release = await this.turn(abort);
        try {
            const startedAt = performance.now();
            const stream = new EmbeddedQueryResultStream(await this.connection.queryStream(query, abort), startedAt);
            void stream.finished.then(release);
            return stream;
        } catch (error) {
            release();
            throw error;
        }
    }

    async close(): Promise<void> {
        await this.connection.close();
    }
}

export class EmbeddedHyperDatabaseChannel implements HyperDatabaseChannel {
    constructor(
        private readonly channel: EmbeddedDatabaseChannel,
    ) {}

    async executeQuery(
        params: pb.salesforce_hyperdb_grpc_v1.pb.QueryParam,
        abort?: AbortSignal,
    ): Promise<QueryExecutionResponseStream> {
        return await this.channel.executeQuery(params.query, abort);
    }

    async close(): Promise<void> {
        await this.channel.close();
    }
}

/// The channel of a connection to the embedded Hyper on the session that the runtime asked for (`session` of the
/// channel request): the database of the instance, or the databases of the clouds folder that a local cloud attaches
/// like a Hyper server. The Hyper log attributes the queries of the session to the client context.
export async function connectEmbeddedHyper(
    database: Pick<EmbeddedComputeDatabase, 'connect'>,
    session: core.EmbeddedHyperSession | null,
    clientContext?: EmbeddedClientContext,
): Promise<EmbeddedHyperDatabaseChannel> {
    const attachedDatabases = await Promise.all((session?.attachedDatabases ?? []).map(async attached => ({
        path: await embeddedAttachedDatabasePath(attached.path),
        alias: attached.alias,
    })));
    const connection = await database.connect({
        defaultDatabase: session == null ? 'hyper' : session.defaultDatabase,
        attachedDatabases,
        clientContext,
    });
    return new EmbeddedHyperDatabaseChannel(new EmbeddedDatabaseChannel(connection));
}

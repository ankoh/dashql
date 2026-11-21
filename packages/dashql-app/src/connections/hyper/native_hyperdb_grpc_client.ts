import * as arrow from 'apache-arrow';
import * as buf from "@bufbuild/protobuf";
import * as pb from "@akohn/dashql/platform/proto";
import * as connection from '@akohn/dashql-jsonschema/connection.js';

import {
    HyperDatabaseChannel,
    HyperDatabaseClient,
    HyperQueryExecutionOptions,
} from '@akohn/dashql/platform/connections/hyper/hyperdb_grpc_client';
import type { EmbeddedClientContext } from '@akohn/dashql/platform/embedded_database';
import {
    NativeGrpcChannel,
    NativeGrpcClient,
    NativeGrpcServerStream,
    NativeGrpcServerStreamMessageIterator,
} from '../../host/native_grpc_client.js';
import {
    createQueryResponseStreamMetrics,
    type QueryExecutionResponseStream, type QueryExecutionMetrics, type QueryStreamItem,
} from '@akohn/dashql/platform/query/query_execution_state';
import { ChannelArgs, ChannelError } from '@akohn/dashql/platform/channel_common';
import { decodeGrpcErrorHeaders, HyperQueryError } from '@akohn/dashql/platform/connections/hyper/hyper_error_info';
import { Logger } from '@akohn/dashql/platform/logger/logger';
import { AsyncValue } from '@akohn/dashql/platform/utils/async_value';
import { yieldToBrowser } from '@akohn/dashql/platform/utils/yield_to_browser';

const LOG_CTX = "native_hyperdb_grpc_client";
const STREAM_YIELD_INTERVAL = 8;

export class QueryResultReader implements AsyncIterator<Uint8Array>, AsyncIterable<Uint8Array> {
    /// The gRPC stream
    grpcStream: NativeGrpcServerStream;
    /// The logger
    logger: Logger;
    /// The message iterator
    messageIterator: NativeGrpcServerStreamMessageIterator;
    /// The metrics
    metrics: QueryExecutionMetrics;

    constructor(stream: NativeGrpcServerStream, logger: Logger) {
        this.grpcStream = stream;
        this.logger = logger;
        this.messageIterator = new NativeGrpcServerStreamMessageIterator(this.grpcStream, logger);
        this.metrics = createQueryResponseStreamMetrics();
    }

    /// Get the next binary result chunk
    async next(): Promise<IteratorResult<Uint8Array>> {
        while (true) {
            const next = await this.messageIterator.next();
            if (next.value == null) {
                return { done: true, value: null };
            }
            const resultMessage = buf.fromBinary(pb.salesforce_hyperdb_grpc_v1.pb.QueryResultSchema$, next.value);
            switch (resultMessage.result.case) {
                // We skip any dedicated header prefix
                case "header":
                    continue;
                // Skip qsv1 chunks
                case "qsv1Chunk":
                    throw new Error("invalid result data message. expected arrowChunk, received qsv1Chunk");
                // Unpack an arrow chunk
                case "arrowChunk": {
                    const buffer = resultMessage.result.value.data;
                    this.metrics.totalDataBytesReceived += buffer.byteLength;
                    return { done: false, value: buffer };
                }
            }
        }
    }

    /// Get the async iterator
    [Symbol.asyncIterator]() {
        return this;
    }
}

/// A native Hyper query result stream
export class NativeHyperQueryResultStream implements QueryExecutionResponseStream {
    /// The query result iterator
    resultReader: QueryResultReader;
    /// The schema Promise
    resultSchema: AsyncValue<arrow.Schema, Error>;

    constructor(stream: NativeGrpcServerStream, logger: Logger) {
        this.resultReader = new QueryResultReader(stream, logger);
        this.resultSchema = new AsyncValue();
    }
    async cancel(): Promise<void> {
        await this.resultReader.grpcStream.destroy();
    }

    /// Get the metrics
    getMetrics(): QueryExecutionMetrics {
        return this.resultReader.metrics;
    }
    /// Await the Arrow schema
    getSchema(): Promise<arrow.Schema> {
        return this.resultSchema.getValue();
    }
    /// The result batches
    async *read(abort?: AbortSignal): AsyncGenerator<QueryStreamItem> {
        const cancel = () => { void this.cancel(); };
        abort?.addEventListener('abort', cancel, { once: true });
        try {
            const arrowReader = await arrow.AsyncRecordBatchStreamReader.from(this.resultReader);
            abort?.throwIfAborted();

            await arrowReader.open();
            abort?.throwIfAborted();
            this.resultSchema.resolve(arrowReader.schema);

            let batchesRead = 0;
            while (true) {
                const iter = await arrowReader!.next();
                abort?.throwIfAborted();
                if (iter.done) {
                    if (iter.value !== undefined) {
                        yield { type: 'batch', batch: iter.value };
                    }
                    return;
                }
                yield { type: 'batch', batch: iter.value };
                if (++batchesRead % STREAM_YIELD_INTERVAL === 0) await yieldToBrowser();
            }
        } catch (e: unknown) {
            // A failed gRPC stream surfaces as a ChannelError whose headers carry
            // the forwarded gRPC richer error model. Decode it into a structured
            // HyperQueryError so the rest of the app sees Hyper's ErrorInfo.
            if (e instanceof ChannelError) {
                const info = decodeGrpcErrorHeaders(e.headers);
                if (info) {
                    throw new HyperQueryError(info, LOG_CTX);
                }
            }
            throw e;
        } finally {
            abort?.removeEventListener('abort', cancel);
        }
    }
}

/// A native Hyper database connection
class NativeHyperDatabaseChannel implements HyperDatabaseChannel {
    constructor(
        /// The gRPC channel
        private readonly grpcChannel: NativeGrpcChannel,
        /// The params of the connection: the attached databases and the query parameters of every query
        private readonly params: connection.HyperConnectionParams,
        /// The client context of every query
        private readonly clientContext: EmbeddedClientContext | null,
        private readonly logger: Logger,
    ) {}

    /// Execute a query against Hyper
    public async executeQuery(query: string, abort?: AbortSignal, options?: HyperQueryExecutionOptions): Promise<QueryExecutionResponseStream> {
        abort?.throwIfAborted();
        const param = buf.create(pb.salesforce_hyperdb_grpc_v1.pb.QueryParamSchema, {
            query,
            outputFormat: pb.salesforce_hyperdb_grpc_v1.pb.QueryParam_OutputFormat.ARROW_STREAM,
        });
        // The settings store the attached databases as objects of a path and an alias
        for (const db of (this.params.attachedDatabases ?? []) as { path: string; alias?: string }[]) {
            param.database.push(buf.create(pb.salesforce_hyperdb_grpc_v1.pb.AttachedDatabaseSchema, db));
        }
        for (const [key, value] of Object.entries(this.params.queryParameters ?? {})) {
            param.params[key] = value;
        }
        if (this.clientContext != null) param.params.external_client_context = JSON.stringify(this.clientContext);
        const stream = await this.grpcChannel.startServerStream({
            path: "/salesforce.hyperdb.grpc.v1.HyperService/ExecuteQuery",
            body: buf.toBinary(pb.salesforce_hyperdb_grpc_v1.pb.QueryParamSchema, param),
            readTimeoutMs: options?.readTimeoutMs,
        });
        if (abort?.aborted) {
            await stream.destroy();
            abort.throwIfAborted();
        }
        return new NativeHyperQueryResultStream(stream, this.logger);
    }

    /// Close the connection
    public async close(): Promise<void> {
        await this.grpcChannel.close();
    }
}

/// A native Hyper database client
export class NativeHyperDatabaseClient implements HyperDatabaseClient {
    /// A logger
    logger: Logger;
    /// A native Hyper client
    client: NativeGrpcClient;

    constructor(logger: Logger) {
        this.logger = logger;
        this.client = new NativeGrpcClient(logger);
    }

    /// Create a database connection, its requests carry the metadata of the params
    public async connect(hyperArgs: connection.HyperConnectionParams, clientContext: EmbeddedClientContext | null): Promise<NativeHyperDatabaseChannel> {
        const tls = hyperArgs.tls;
        const isHttps = new URL(hyperArgs.endpoint).protocol === "https:";
        const useTls = isHttps || Boolean(
            tls?.clientKeyPath || tls?.clientCertPath || tls?.caCertsPath,
        );
        if (useTls && !isHttps) {
            throw new Error("TLS certificate paths require an https:// endpoint");
        }
        const args: ChannelArgs = {
            endpoint: hyperArgs.endpoint,
            tls: useTls ? {
                keyPath: tls?.clientKeyPath,
                pubPath: tls?.clientCertPath,
                caPath: tls?.caCertsPath,
            } : undefined
        };
        const channel = await this.client.connect(args, hyperArgs.metadata ?? {});
        return new NativeHyperDatabaseChannel(channel, hyperArgs, clientContext, this.logger);
    }
}

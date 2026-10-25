import type * as arrow from 'apache-arrow';
import * as buf from '@bufbuild/protobuf';
import * as pb from '../../../proto.js';

import type { EmbeddedClientContext } from '../../../platform/database/embedded_database.js';
import type { HyperDBSourceConnection, HyperDBSourceDatabase } from '../../../platform/hyperdb/hyperdb_incremental_extract.js';
import { consumeQueryResponseStream } from '../query_execution.js';
import type { HyperDatabaseChannel } from './hyperdb_grpc_client.js';

/// A query on a channel to a remote Hyper, the channel keeps no session across its queries
class HyperChannelConnection implements HyperDBSourceConnection {
    constructor(
        /// The channel
        private readonly channel: HyperDatabaseChannel,
    ) {}

    async query(query: string, abort?: AbortSignal): Promise<arrow.Table> {
        const param = buf.create(pb.salesforce_hyperdb_grpc_v1.pb.QueryParamSchema, { query });
        const stream = await this.channel.executeQuery(param, abort);
        return (await consumeQueryResponseStream({ stream, abort, publishResults: true, onProgress: () => {} }))!;
    }

    async execute(statement: string, abort?: AbortSignal): Promise<bigint | null> {
        await this.query(statement, abort);
        return null;
    }

    async close(): Promise<void> {
        await this.channel.close();
    }
}

/// A remote Hyper as the source of an extract, e.g. of the Hyper log. Every connection is a channel of its own.
export class HyperChannelDatabase implements HyperDBSourceDatabase {
    constructor(
        /// Open a channel to the Hyper whose queries have a client context
        private readonly openChannel: (clientContext: EmbeddedClientContext | null) => Promise<HyperDatabaseChannel>,
    ) {}

    async connect(options?: { clientContext?: EmbeddedClientContext }): Promise<HyperDBSourceConnection> {
        return new HyperChannelConnection(await this.openChannel(options?.clientContext ?? null));
    }
}

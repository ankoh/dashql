import * as buf from '@bufbuild/protobuf';
import * as proto from '../../proto.js';
import type { QueryExecutionArgs } from './query_execution_args.js';

/// The channel of a connection, the connectors pass a channel override first while the connection is set up
export function requireChannel<T>(channel: T | null, connector: string): T {
    if (channel == null) {
        throw new Error(`${connector} channel is not set up`);
    }
    return channel;
}

/// The query param of a query execution
export function queryParam(args: QueryExecutionArgs): proto.salesforce_hyperdb_grpc_v1.pb.QueryParam {
    return buf.create(proto.salesforce_hyperdb_grpc_v1.pb.QueryParamSchema, { query: args.query });
}

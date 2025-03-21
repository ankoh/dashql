import * as proto from '@ankoh/dashql-protobuf';

import { QueryExecutionArgs } from "../query_execution_args.js";
import { HyperGrpcConnectionDetails } from "./hyper_connection_state.js";
import { QueryExecutionResponseStream } from '../query_execution_state.js';

export async function executeHyperQuery(conn: HyperGrpcConnectionDetails, args: QueryExecutionArgs, abort?: AbortSignal): Promise<QueryExecutionResponseStream> {
    if (!conn.channel) {
        throw new Error(`hyper channel is not set up`);
    }
    const param = new proto.salesforce_hyperdb_grpc_v1.pb.QueryParam({
        query: args.query
    });
    return await conn.channel.executeQuery(param, abort);
}

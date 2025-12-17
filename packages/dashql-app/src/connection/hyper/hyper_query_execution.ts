import * as proto from '@ankoh/dashql-protobuf';
import * as buf from "@bufbuild/protobuf";

import { QueryExecutionArgs } from "../query_execution_args.js";
import { HyperConnectionDetails } from "./hyper_connection_state.js";
import { QueryExecutionResponseStream } from '../query_execution_state.js';

export async function executeHyperQuery(conn: HyperConnectionDetails, args: QueryExecutionArgs, abort?: AbortSignal): Promise<QueryExecutionResponseStream> {
    if (!conn.channel) {
        throw new Error(`hyper channel is not set up`);
    }
    const param = buf.create(proto.salesforce_hyperdb_grpc_v1.pb.QueryParamSchema, {
        query: args.query
    });
    return await conn.channel.executeQuery(param, abort);
}

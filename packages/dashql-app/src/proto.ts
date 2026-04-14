/** Barrel for remaining protobuf TS from //proto/pb:ts_gen (Bazel :proto; alias @ankoh/dashql-protobuf in Vite/Jest). */
import * as google_empty from '@ankoh/dashql-protobuf/google/protobuf/empty_pb.js';
import * as google_timestamp from '@ankoh/dashql-protobuf/google/protobuf/timestamp_pb.js';
import * as salesforce_hyperdb_grpc_v1_pb_ from '@ankoh/dashql-protobuf/salesforce/hyperdb/grpc/v1/hyper_service_pb.js';

export namespace salesforce_hyperdb_grpc_v1 {
    export import pb = salesforce_hyperdb_grpc_v1_pb_;
}

export namespace google_protobuf {
    export import empty = google_empty;
    export import timestamp = google_timestamp;
}

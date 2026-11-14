/** Barrel for remaining protobuf TS from //proto/pb:ts_gen (Bazel :proto; alias @ankoh/dashql-protobuf in Vite/Jest). */
import * as google_any from '@ankoh/dashql-protobuf/google/protobuf/any_pb.js';
import * as google_empty from '@ankoh/dashql-protobuf/google/protobuf/empty_pb.js';
import * as google_timestamp from '@ankoh/dashql-protobuf/google/protobuf/timestamp_pb.js';
import * as google_rpc_status from '@ankoh/dashql-protobuf/google/rpc/status_pb.js';
import * as salesforce_hyperdb_grpc_v1_pb_ from '@ankoh/dashql-protobuf/salesforce/hyperdb/grpc/v1/hyper_service_pb.js';
import * as salesforce_hyperdb_grpc_v1_error_details_ from '@ankoh/dashql-protobuf/salesforce/hyperdb/grpc/v1/error_details_pb.js';

export namespace salesforce_hyperdb_grpc_v1 {
    export import pb = salesforce_hyperdb_grpc_v1_pb_;
    export import error_details = salesforce_hyperdb_grpc_v1_error_details_;
}

export namespace google_protobuf {
    export import any = google_any;
    export import empty = google_empty;
    export import timestamp = google_timestamp;
}

export namespace google_rpc {
    export import status = google_rpc_status;
}

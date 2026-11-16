/** Barrel for remaining protobuf TS from //proto/pb:ts_gen (Bazel :proto; alias @akohn/dashql-protobuf in Vite/Jest). */
import * as google_rpc_status from '@akohn/dashql-protobuf/google/rpc/status_pb.js';
import * as salesforce_hyperdb_grpc_v1_pb_ from '@akohn/dashql-protobuf/salesforce/hyperdb/grpc/v1/hyper_service_pb.js';
import * as salesforce_hyperdb_grpc_v1_error_details_ from '@akohn/dashql-protobuf/salesforce/hyperdb/grpc/v1/error_details_pb.js';

export namespace salesforce_hyperdb_grpc_v1 {
    export import pb = salesforce_hyperdb_grpc_v1_pb_;
    export import error_details = salesforce_hyperdb_grpc_v1_error_details_;
}

export namespace google_rpc {
    export import status = google_rpc_status;
}

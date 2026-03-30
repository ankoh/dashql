/** Barrel for protobuf TS from //proto/pb:ts_gen (Bazel :proto; alias @ankoh/dashql-protobuf in Vite/Jest). */
import * as dashql_app_event_pb_ from '@ankoh/dashql-protobuf/dashql/app_event_pb.js';
import * as dashql_catalog_pb_ from '@ankoh/dashql-protobuf/dashql/catalog_pb.js';

import * as dashql_connection_pb_ from '@ankoh/dashql-protobuf/dashql/connection_pb.js';
import * as dashql_error_pb_ from '@ankoh/dashql-protobuf/dashql/error_pb.js';
import * as dashql_file_pb_ from '@ankoh/dashql-protobuf/dashql/file_pb.js';
import * as dashql_auth_pb_ from '@ankoh/dashql-protobuf/dashql/auth_pb.js';
import * as dashql_notebook_pb_ from '@ankoh/dashql-protobuf/dashql/notebook_pb.js';
import * as google_empty from '@ankoh/dashql-protobuf/google/protobuf/empty_pb.js';
import * as google_timestamp from '@ankoh/dashql-protobuf/google/protobuf/timestamp_pb.js';
import * as salesforce_hyperdb_grpc_v1_pb_ from '@ankoh/dashql-protobuf/salesforce/hyperdb/grpc/v1/hyper_service_pb.js';

export namespace salesforce_hyperdb_grpc_v1 {
    export import pb = salesforce_hyperdb_grpc_v1_pb_;
}

export namespace dashql {
    export import app_event = dashql_app_event_pb_;
    export import catalog = dashql_catalog_pb_;

    export import connection = dashql_connection_pb_;
    export import error = dashql_error_pb_;
    export import file = dashql_file_pb_;
    export import auth = dashql_auth_pb_;
    export import notebook = dashql_notebook_pb_;
}

export namespace google_protobuf {
    export import empty = google_empty;
    export import timestamp = google_timestamp;
}

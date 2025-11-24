import * as pb from '@ankoh/dashql-protobuf';
import * as buf from "@bufbuild/protobuf";

import { WorkbookExportSettings } from '../../workbook/workbook_export_settings.js';

export interface ServerlessConnectionParams { }

export function encodeServerlessConnectionParamsAsProto(_settings: WorkbookExportSettings | null): pb.dashql.connection.ConnectionParams {
    return buf.create(pb.dashql.connection.ConnectionParamsSchema, {
        connection: {
            case: "serverless",
            value: buf.create(pb.dashql.connection.ServerlessParamsSchema)
        }
    });
}

export function readServerlessConnectionParamsFromProto(_params: pb.dashql.connection.ServerlessParams): ServerlessConnectionParams {
    return {};
}

export function createServerlessConnectionParamsSignature(_params: pb.dashql.connection.ServerlessParams): any {
    return { case: "serverless" };
}

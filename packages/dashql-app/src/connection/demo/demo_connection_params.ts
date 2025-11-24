import * as pb from '@ankoh/dashql-protobuf';
import * as buf from "@bufbuild/protobuf";

import { WorkbookExportSettings } from '../../workbook/workbook_export_settings.js';

export function encodeDemoConnectionParamsAsProto(_settings: WorkbookExportSettings | null): pb.dashql.connection.ConnectionParams {
    return buf.create(pb.dashql.connection.ConnectionParamsSchema, {
        connection: {
            case: "demo",
            value: buf.create(pb.dashql.connection.DemoParamsSchema)
        }
    });
}

export function createDemoConnectionParamsSignature(_params: pb.dashql.connection.DemoParams): any {
    return { case: "demo" };
}

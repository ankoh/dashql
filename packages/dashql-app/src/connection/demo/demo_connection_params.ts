import * as pb from '@ankoh/dashql-protobuf';
import * as buf from "@bufbuild/protobuf";

import { WorkbookExportSettings } from '../../workbook/workbook_export_settings.js';
import { DemoConnectionParams } from './demo_connection_state.js';
import { DemoDatabaseChannel } from './demo_database_channel.js';

export function encodeDemoConnectionParamsAsProto(_settings: WorkbookExportSettings | null): pb.dashql.connection.ConnectionParams {
    return buf.create(pb.dashql.connection.ConnectionParamsSchema, {
        connection: {
            case: "demo",
            value: buf.create(pb.dashql.connection.DemoParamsSchema)
        }
    });
}

export function readDemoConnectionParamsFromProto(_params: pb.dashql.connection.DemoParams): DemoConnectionParams {
    return {
        channel: new DemoDatabaseChannel(),
    };
}

export function createDemoConnectionParamsSignature(_params: DemoConnectionParams): any {
    return { case: "demo" };
}

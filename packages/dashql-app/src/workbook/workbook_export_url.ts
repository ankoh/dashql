import * as pb from '@ankoh/dashql-protobuf';
import * as buf from "@bufbuild/protobuf";

import { WorkbookState } from './workbook_state.js';
import { BASE64URL_CODEC } from '../utils/base64.js';
import { ConnectionState } from '../connection/connection_state.js';
import { getConnectionParamsFromStateDetails } from '../connection/connection_params.js';
import { WorkbookExportSettings } from './workbook_export_settings.js';

export function encodeWorkbookAsProto(workbookState: WorkbookState | null, connectionState: ConnectionState, settings: WorkbookExportSettings | null = null): pb.dashql.workbook.Workbook {
    // Get connection params
    const params = getConnectionParamsFromStateDetails(connectionState.details);

    // Collect the scripts
    const scripts: pb.dashql.workbook.WorkbookScript[] = [];
    if (workbookState != null) {
        for (const k in workbookState.scripts) {
            const script = workbookState.scripts[k];
            scripts.push(buf.create(pb.dashql.workbook.WorkbookScriptSchema, {
                scriptId: script.scriptKey as number,
                scriptText: script.script?.toString() ?? "",
            }));
        }
    } else {
        scripts.push(buf.create(pb.dashql.workbook.WorkbookScriptSchema, {
            scriptId: 0,
            scriptText: "",
        }));
    }
    const setup = buf.create(pb.dashql.workbook.WorkbookSchema, {
        connectionParams: (params == null) ? undefined : params,
        scripts: scripts,
        workbookEntries: workbookState?.workbookEntries.map(e => (
            buf.create(pb.dashql.workbook.WorkbookEntrySchema, {
                scriptId: e.scriptKey,
                title: e.title ?? undefined,
            })
        )),
        workbookMetadata: {
            fileName: workbookState?.workbookMetadata.fileName
        }
    });
    return setup;
}

export enum WorkbookLinkTarget {
    NATIVE,
    WEB
}

export function encodeWorkbookProtoAsUrl(setup: pb.dashql.workbook.Workbook, target: WorkbookLinkTarget): URL {
    const eventData = buf.create(pb.dashql.app_event.AppEventDataSchema, {
        data: {
            case: "workbook",
            value: setup
        }
    });
    const eventDataBytes = buf.toBinary(pb.dashql.app_event.AppEventDataSchema, eventData);
    const eventDataBase64 = BASE64URL_CODEC.encode(eventDataBytes.buffer);

    switch (target) {
        case WorkbookLinkTarget.WEB:
            return new URL(`${process.env.DASHQL_APP_URL!}?data=${eventDataBase64}`);
        case WorkbookLinkTarget.NATIVE:
            return new URL(`dashql://localhost?data=${eventDataBase64}`);
    };
}

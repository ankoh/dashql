import * as pb from '@ankoh/dashql-protobuf';
import * as buf from "@bufbuild/protobuf";

import { ConnectionState } from '../connection/connection_state.js';
import { WorkbookExportSettings } from './workbook_export_settings.js';
import { WorkbookState } from './workbook_state.js';
import { getConnectionParamsFromStateDetails } from '../connection/connection_params.js';
import { encodeCatalogAsProto } from '../connection/catalog_export.js';

export function encodeWorkbookAsFile(workbookState: WorkbookState, connectionState: ConnectionState, settings: WorkbookExportSettings | null = null): pb.dashql.file.File {
    // Get connection params
    const params = getConnectionParamsFromStateDetails(connectionState.details);

    // Pack the connection params
    if (params == null) {
        throw new Error("Connection params are null");
    }

    // Collect the scripts
    const scripts: pb.dashql.workbook.WorkbookScript[] = [];
    for (const k in workbookState.scripts) {
        const script = workbookState.scripts[k];
        scripts.push(buf.create(pb.dashql.workbook.WorkbookScriptSchema, {
            scriptId: script.scriptKey as number,
            scriptText: script.script?.toString() ?? "",
        }));
    }
    const workbook = buf.create(pb.dashql.workbook.WorkbookSchema, {
        connectionParams: params,
        scripts: scripts,
        workbookEntries: workbookState.workbookEntries.map(e => (
            buf.create(pb.dashql.workbook.WorkbookEntrySchema, {
                scriptId: e.scriptKey,
                title: e.title ?? undefined,
            })
        )),
        workbookMetadata: {
            fileName: workbookState.workbookMetadata.fileName
        }
    });

    // Pack the file
    const file = buf.create(pb.dashql.file.FileSchema, {
        workbooks: [workbook]
    });

    // Encode the catalog if requested
    if (settings?.exportCatalog) {
        const catalogSnapshot = connectionState.catalog.createSnapshot();
        const catalogProto = encodeCatalogAsProto(catalogSnapshot);
        const c = buf.create(pb.dashql.file.FileCatalogSchema, {
            connectionParams: params,
            catalog: catalogProto
        });
        file.catalogs.push(c);
    }
    return file;
}

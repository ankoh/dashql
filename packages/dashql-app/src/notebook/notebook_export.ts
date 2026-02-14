import * as pb from '@ankoh/dashql-protobuf';
import * as buf from "@bufbuild/protobuf";

import { BASE64URL_CODEC } from '../utils/base64.js';
import { ConnectionState } from '../connection/connection_state.js';
import { NotebookState } from './notebook_state.js';
import { encodeCatalogAsProto } from '../connection/catalog_export.js';
import { getConnectionParamsFromStateDetails } from '../connection/connection_params.js';

export function encodeNotebookAsProto(notebookState: NotebookState, withScripts: boolean, conn: pb.dashql.connection.ConnectionParams | null = null): pb.dashql.notebook.Notebook {
    // Pack the scripts
    let scripts: pb.dashql.notebook.NotebookScript[] | undefined = undefined;
    if (withScripts) {
        scripts = [];
        for (const k in notebookState.scripts) {
            const script = notebookState.scripts[k];
            scripts.push(buf.create(pb.dashql.notebook.NotebookScriptSchema, {
                scriptId: script.scriptKey as number,
                scriptText: script.script?.toString() ?? "",
            }));
        }
    }
    const wb = buf.create(pb.dashql.notebook.NotebookSchema, {
        connectionParams: conn ?? undefined,
        scripts,
        notebookPages: notebookState?.notebookPages ?? [],
        notebookMetadata: {
            originalFileName: notebookState?.notebookMetadata.originalFileName
        }
    });
    return wb;
}

export function encodeNotebookAsFile(notebookState: NotebookState, connectionState: ConnectionState, withCatalog: boolean): pb.dashql.file.File {
    const connParams = getConnectionParamsFromStateDetails(connectionState.details) ?? undefined;
    const notebook = encodeNotebookAsProto(notebookState, true, connParams);

    // Pack the file
    const file = buf.create(pb.dashql.file.FileSchema, {
        notebooks: [notebook]
    });

    // Encode the catalog, if requested
    if (withCatalog) {
        const catalogSnapshot = connectionState.catalog.createSnapshot();
        const catalogProto = encodeCatalogAsProto(catalogSnapshot, connParams ?? null);
        file.catalogs.push(catalogProto);
    }
    return file;
}

export enum NotebookLinkTarget {
    NATIVE,
    WEB
}

export function encodeNotebookProtoAsUrl(setup: pb.dashql.notebook.Notebook, target: NotebookLinkTarget): URL {
    const eventData = buf.create(pb.dashql.app_event.AppEventDataSchema, {
        data: {
            case: "notebook",
            value: setup
        }
    });
    const eventDataBytes = buf.toBinary(pb.dashql.app_event.AppEventDataSchema, eventData);
    const eventDataBase64 = BASE64URL_CODEC.encode(eventDataBytes.buffer);

    switch (target) {
        case NotebookLinkTarget.WEB:
            return new URL(`${process.env.DASHQL_APP_URL!}?data=${eventDataBase64}`);
        case NotebookLinkTarget.NATIVE:
            return new URL(`dashql://localhost?data=${eventDataBase64}`);
    };
}

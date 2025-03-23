import * as React from 'react';
import * as core from '@ankoh/dashql-core';
import * as pb from '@ankoh/dashql-protobuf';
import * as zstd from '../utils/zstd.js';
import Immutable from 'immutable';

import { CATALOG_DEFAULT_DESCRIPTOR_POOL } from '../connection/catalog_update_state.js';
import { ConnectionAllocator } from '../connection/connection_registry.js';
import { ConnectionStateWithoutId } from '../connection/connection_state.js';
import { PlatformFile } from "../platform/file.js";
import { ScriptData, WorkbookEntry } from '../workbook/workbook_state.js';
import { ScriptLoadingStatus } from '../workbook/script_loader.js';
import { WorkbookAllocator, WorkbookStateWithoutId } from '../workbook/workbook_state_registry.js';
import { createConnectionParamsSignature, createConnectionStateFromParams, readConnectionParamsFromProto } from '../connection/connection_params.js';
import { decodeCatalogFileFromProto } from '../connection/catalog_import.js';
import { ScriptOriginType, ScriptType } from '../workbook/script_metadata.js';
import { DashQLSetupFn, useDashQLCoreSetup } from '../core_provider.js';

interface Props {
    file: PlatformFile;
}

async function loadDashQLFile(file: PlatformFile, dqlSetup: DashQLSetupFn, allocateConn: ConnectionAllocator, allocateWorkbook: WorkbookAllocator, signal: AbortSignal) {
    try {
        // Setup DashQL
        const dql = await dqlSetup("file_loader");
        signal.throwIfAborted();

        // Read the file
        const fileBuffer = await file.readAsArrayBuffer();
        signal.throwIfAborted();

        // Decompress the file buffer
        await zstd.init();
        signal.throwIfAborted();
        const fileDecompressed = zstd.decompress(fileBuffer);
        const fileProto = pb.dashql.file.File.fromBinary(fileDecompressed);

        // The connection map
        const connMap = new Map<string, [number, ConnectionStateWithoutId]>();
        const workbookIds: number[] = [];

        // Setup connection catalogs
        for (const fileCatalog of fileProto.catalogs) {
            if (!fileCatalog.connectionParams) {
                continue;
            }
            // Read connection params
            const params = readConnectionParamsFromProto(fileCatalog.connectionParams);
            if (!params) {
                continue;
            }
            // Compute signature
            const paramsSigObj = createConnectionParamsSignature(params);
            const paramsSig = JSON.stringify(paramsSigObj);

            // Allocate connection state
            let connState: ConnectionStateWithoutId | null = null;
            let connId: number | null = null;
            let prevConn = connMap.get(paramsSig);
            if (!prevConn) {
                connState = createConnectionStateFromParams(dql, params);
                connId = allocateConn(connState);
                connMap.set(paramsSig, [connId, connState]);
                continue;
            } else {
                [connId, connState] = prevConn;
            }

            // Add schema descriptors
            const catalogProto = decodeCatalogFileFromProto(fileCatalog);
            connState!.catalog.addSchemaDescriptorsT(CATALOG_DEFAULT_DESCRIPTOR_POOL, catalogProto);
        }

        // Setup workbook connections that are not covered by catalogs
        for (const workbook of fileProto.workbooks) {
            if (!workbook.connectionParams) {
                continue;
            }
            // Read connection params
            const params = readConnectionParamsFromProto(workbook.connectionParams);
            if (!params) {
                continue;
            }
            // Compute signature
            const paramsSigObj = createConnectionParamsSignature(params);
            const paramsSig = JSON.stringify(paramsSigObj);

            // Allocate connection state
            let connState: ConnectionStateWithoutId | null = null;
            let connId: number | null = null;
            let prevConn = connMap.get(paramsSig);
            if (!prevConn) {
                connState = createConnectionStateFromParams(dql, params);
                connId = allocateConn(connState);
                connMap.set(paramsSig, [connId, connState]);
                continue;
            } else {
                [connId, connState] = prevConn;
            }

            // Collect workbook scripts
            let scripts: Record<number, ScriptData> = {};
            for (const script of workbook.scripts) {
                // Duplicate script key?
                const existingScript = scripts[script.scriptId];
                if (existingScript) {
                    continue;
                }

                // Create a script
                const s = dql.createScript(connState.catalog, script.scriptId);
                s.replaceText(script.scriptText);

                // Deterime script type
                let t = ScriptType.UNKNOWN;
                switch (script.scriptType) {
                    case pb.dashql.workbook.ScriptType.Schema:
                        t = ScriptType.SCHEMA;
                        break;
                    case pb.dashql.workbook.ScriptType.Query:
                        t = ScriptType.QUERY;
                        break;
                }

                // Allocate the script data
                scripts[script.scriptId] = {
                    scriptKey: script.scriptId,
                    script: s,
                    metadata: {
                        scriptType: t,
                        originType: ScriptOriginType.FILE,
                        originalSchemaName: null,
                        originalScriptName: null,
                        originalHttpURL: null,
                        annotations: null,
                        immutable: false,
                    },
                    loading: {
                        status: ScriptLoadingStatus.SUCCEEDED,
                        error: null,
                        startedAt: null,
                        finishedAt: null,
                    },
                    processed: {
                        scanned: null,
                        parsed: null,
                        analyzed: null,
                        destroy: () => { },
                    },
                    outdatedAnalysis: true,
                    statistics: Immutable.List(),
                    cursor: null,
                    completion: null,
                    selectedCompletionCandidate: null,
                };

                // Is a schema script?
                if (script.scriptType === pb.dashql.workbook.ScriptType.Schema) {
                    // XXX
                    // s.scan();
                    // s.parse();
                    // s.analyze();
                }
            }

            // Create workbook entries
            const workbookEntries: WorkbookEntry[] = workbook.workbookEntries.map(e => ({
                scriptKey: e.scriptId,
                queryId: null,
                title: e.title
            }));

            // Allocate workbook state
            const workbookState: WorkbookStateWithoutId = {
                instance: dql,
                connectorInfo: connState.connectorInfo,
                connectionId: connId,
                connectionCatalog: connState.catalog,
                scripts,
                workbookEntries,
                selectedWorkbookEntry: 0,
                userFocus: null
            };
            const workbookId = allocateWorkbook(workbookState);
            workbookIds.push(workbookId);

            console.log(workbookState);
        }

        // XXX Switch current workbook

        console.log(`read bytes: ${fileBuffer.byteLength}, decompressed: ${fileDecompressed.byteLength}`);
        console.log(fileProto);
    } catch (e: any) {
        console.log(e);
    }
}

export function FileLoader(props: Props) {
    const dql = useDashQLCoreSetup();

    React.useEffect(() => {

    });

    return <div />;
}

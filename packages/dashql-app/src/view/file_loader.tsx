import * as React from 'react';
import * as pb from '@ankoh/dashql-protobuf';
import * as zstd from '../utils/zstd.js';
import Immutable from 'immutable';

import { CATALOG_DEFAULT_DESCRIPTOR_POOL } from '../connection/catalog_update_state.js';
import { ConnectionAllocator, useConnectionStateAllocator } from '../connection/connection_registry.js';
import { ConnectionStateWithoutId } from '../connection/connection_state.js';
import { PlatformFile } from "../platform/file.js";
import { ScriptData, WorkbookEntry } from '../workbook/workbook_state.js';
import { ScriptLoadingStatus } from '../workbook/script_loader.js';
import { useWorkbookStateAllocator, WorkbookAllocator, WorkbookStateWithoutId } from '../workbook/workbook_state_registry.js';
import { createConnectionParamsSignature, createConnectionStateFromParams, readConnectionParamsFromProto } from '../connection/connection_params.js';
import { decodeCatalogFileFromProto } from '../connection/catalog_import.js';
import { ScriptOriginType, ScriptType } from '../workbook/script_metadata.js';
import { DashQLSetupFn, useDashQLCoreSetup } from '../core_provider.js';

interface ProgressState {
    // The time when the file reading started
    fileReadingStartedAt: Date | null;
    // The time when the file finished at
    fileReadingFinishedAt: Date | null;
    // The file size
    fileByteCount: number | null;

    // The time when the file decompressing started
    fileDecompressingStartedAt: Date | null;
    // The time when the file decompressing finished
    fileDecompressingFinishedAt: Date | null;
    // The decompressed file size
    fileDecompressedByteCount: number | null;

    // The number of catalogs
    catalogCount: number | null;
    // The number of loaded catalogs
    catalogsLoaded: number;
    // The time when the loading of the first catalog started
    catalogLoadingStartedAt: Date | null;
    // The time when the loading of the last catalog finished
    catalogLoadingFinishedAt: Date | null;

    // The number of workbooks
    workbookCount: number | null;
    // The number of loaded workbooks
    workbooksLoaded: number;
    // The time when the loading of the first workbook started
    workbookLoadingStartedAt: Date | null;
    // The time when the loading of the last workbook finished
    workbookLoadingFinishedAt: Date | null;

    // The time when the loading finished
    fileLoadingFinishedAt: Date | null;
}

type UpdateProgressFn = (state: ProgressState) => void;

interface Props {
    file: PlatformFile;
}

async function loadDashQLFile(file: PlatformFile, dqlSetup: DashQLSetupFn, allocateConn: ConnectionAllocator, allocateWorkbook: WorkbookAllocator, updateProgress: UpdateProgressFn, signal: AbortSignal) {
    const progress: ProgressState = {
        fileReadingStartedAt: null,
        fileReadingFinishedAt: null,
        fileByteCount: null,

        fileDecompressingStartedAt: null,
        fileDecompressingFinishedAt: null,
        fileDecompressedByteCount: null,

        catalogCount: null,
        catalogsLoaded: 0,
        catalogLoadingStartedAt: null,
        catalogLoadingFinishedAt: null,

        workbookCount: null,
        workbooksLoaded: 0,
        workbookLoadingStartedAt: null,
        workbookLoadingFinishedAt: null,

        fileLoadingFinishedAt: null,
    };
    try {
        progress.fileReadingStartedAt = new Date();
        updateProgress({ ...progress });

        // Setup DashQL
        const dql = await dqlSetup("file_loader");
        signal.throwIfAborted();

        // Read the file
        const fileBuffer = await file.readAsArrayBuffer();
        signal.throwIfAborted();

        progress.fileReadingFinishedAt = new Date();
        progress.fileByteCount = fileBuffer.byteLength;
        progress.fileDecompressingStartedAt = progress.fileReadingFinishedAt;
        updateProgress({ ...progress });

        // Decompress the file buffer
        await zstd.init();
        signal.throwIfAborted();
        const fileDecompressed = zstd.decompress(fileBuffer);
        const fileProto = pb.dashql.file.File.fromBinary(fileDecompressed);

        progress.fileDecompressingFinishedAt = new Date();
        progress.fileDecompressedByteCount = fileDecompressed.byteLength;
        progress.catalogLoadingStartedAt = progress.fileDecompressingFinishedAt;
        progress.catalogCount = fileProto.catalogs.length;
        progress.workbookCount = fileProto.workbooks.length;
        updateProgress({ ...progress });

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
            } else {
                [connId, connState] = prevConn;
            }

            // Add schema descriptors
            const catalogProto = decodeCatalogFileFromProto(fileCatalog);
            connState!.catalog.addSchemaDescriptorsT(CATALOG_DEFAULT_DESCRIPTOR_POOL, catalogProto);

            progress.catalogLoadingFinishedAt = new Date();
            progress.catalogsLoaded += 1;
            updateProgress({ ...progress });
        }

        progress.workbookLoadingStartedAt = new Date();
        updateProgress({ ...progress });

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

            progress.workbookLoadingFinishedAt = new Date();
            progress.workbooksLoaded += 1;
            updateProgress({ ...progress });
        }

        progress.fileLoadingFinishedAt = new Date();
        updateProgress({ ...progress });

    } catch (e: any) {
        console.log(e);
    }
}

export function FileLoader(props: Props) {
    const dqlSetup = useDashQLCoreSetup();
    const allocateConnection = useConnectionStateAllocator();
    const allocateWorkbook = useWorkbookStateAllocator();
    const [_progress, setProgress] = React.useState<ProgressState | null>(null);

    React.useEffect(() => {
        const proxiedSetProgress = (value: ProgressState | null) => {
            console.log(value);
            setProgress(value);
        };

        const abort = new AbortController();
        loadDashQLFile(props.file, dqlSetup, allocateConnection, allocateWorkbook, proxiedSetProgress, abort.signal);
        return () => abort.abort();

    }, [dqlSetup, allocateWorkbook, allocateConnection, props.file]);

    return <div />;
}

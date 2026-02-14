import * as React from 'react';
import * as Immutable from 'immutable';
import * as core from '@ankoh/dashql-core';
import * as pb from '@ankoh/dashql-protobuf';
import * as buf from "@bufbuild/protobuf";
import * as zstd from '../utils/zstd.js';

import symbols from '../../static/svg/symbols.generated.svg';
import * as baseStyles from './banner_page.module.css';
import * as styles from './file_loader.module.css';

import { CATALOG_DEFAULT_DESCRIPTOR_POOL } from '../connection/catalog_update_state.js';
import { ConnectionAllocator, useConnectionRegistry, useConnectionStateAllocator } from '../connection/connection_registry.js';
import { ConnectionSignatureMap } from '../connection/connection_signature.js';
import { ConnectionState } from '../connection/connection_state.js';
import { DASHQL_VERSION } from '../globals.js';
import { DashQLSetupFn, useDashQLCoreSetup } from '../core_provider.js';
import { IndicatorStatus, StatusIndicator } from './foundations/status_indicator.js';
import { PlatformFile } from "../platform/file.js";
import { ScriptData } from '../notebook/notebook_state.js';
import { classNames } from '../utils/classnames.js';
import { createConnectionParamsSignature, createConnectionStateFromParams } from '../connection/connection_params.js';
import { decodeCatalogFromProto } from '../connection/catalog_import.js';
import { formatBytes } from '../utils/format.js';
import { analyzeScript } from './editor/dashql_processor.js';
import { useRouterNavigate, NOTEBOOK_PATH } from '../router.js';
import { useNotebookRegistry, useNotebookStateAllocator, NotebookAllocator } from '../notebook/notebook_state_registry.js';
import { groupCatalogWrites, StorageWriter, WRITE_CONNECTION_CATALOG } from '../storage/storage_writer.js';
import { useStorageWriter } from '../storage/storage_provider.js';

interface ProgressState {
    // The file size
    fileByteCount: number | null;
    // The time when the file reading started
    fileReadingStartedAt: Date | null;
    // The time when the file finished at
    fileReadingFinishedAt: Date | null;
    // The time when the file failed at
    fileReadingFailedAt: Date | null;

    // The decompressed file size
    fileDecompressedByteCount: number | null;
    // The time when the file decompressing started
    fileDecompressingStartedAt: Date | null;
    // The time when the file decompressing finished
    fileDecompressingFinishedAt: Date | null;
    // The time when the file decompressing failed
    fileDecompressingFailedAt: Date | null;

    // The number of catalogs
    catalogCount: number | null;
    // The number of loaded catalogs
    catalogsLoaded: number;
    // The time when the loading of the first catalog started
    catalogLoadingStartedAt: Date | null;
    // The time when the loading of the last catalog finished
    catalogLoadingFinishedAt: Date | null;
    // The time when the loading of the last catalog failed
    catalogLoadingFailedAt: Date | null;

    // The number of notebooks
    notebookCount: number | null;
    // The number of loaded notebooks
    notebooksLoaded: number;
    // The time when the loading of the first notebook started
    notebookLoadingStartedAt: Date | null;
    // The time when the loading of the last notebook finished
    notebookLoadingFinishedAt: Date | null;
    // The time when the loading of the last notebook failed
    notebookLoadingFailedAt: Date | null;

    // The time when the loading finished
    fileLoadingFinishedAt: Date | null;
}

type UpdateProgressFn = (state: ProgressState) => void;

async function loadDashQLFile(file: PlatformFile, dqlSetup: DashQLSetupFn, allocateConn: ConnectionAllocator, allocateNotebook: NotebookAllocator, storage: StorageWriter, updateProgress: UpdateProgressFn, connSigs: ConnectionSignatureMap, signal: AbortSignal): Promise<number[]> {
    const progress: ProgressState = {
        fileByteCount: null,
        fileReadingStartedAt: null,
        fileReadingFinishedAt: null,
        fileReadingFailedAt: null,

        fileDecompressedByteCount: null,
        fileDecompressingStartedAt: null,
        fileDecompressingFinishedAt: null,
        fileDecompressingFailedAt: null,

        catalogCount: null,
        catalogsLoaded: 0,
        catalogLoadingStartedAt: null,
        catalogLoadingFinishedAt: null,
        catalogLoadingFailedAt: null,

        notebookCount: null,
        notebooksLoaded: 0,
        notebookLoadingStartedAt: null,
        notebookLoadingFinishedAt: null,
        notebookLoadingFailedAt: null,

        fileLoadingFinishedAt: null,
    };

    // Read the file as buffer
    let dql: core.DashQL;
    let fileBuffer: Uint8Array;
    try {
        progress.fileReadingStartedAt = new Date();
        updateProgress({ ...progress });

        // Setup DashQL
        dql = await dqlSetup("file_loader");
        signal.throwIfAborted();

        // Read the file
        fileBuffer = await file.readAsArrayBuffer();
        signal.throwIfAborted();

        progress.fileReadingFinishedAt = new Date();
        progress.fileByteCount = fileBuffer.byteLength;
    } catch (e: any) {
        progress.fileDecompressingFailedAt = new Date();
        updateProgress({ ...progress });
        throw e;
    }

    progress.fileDecompressingStartedAt = progress.fileReadingFinishedAt;
    updateProgress({ ...progress });

    // Decompress and decode the buffer
    let fileProto: pb.dashql.file.File;
    try {
        // Decompress the file buffer
        await zstd.init();
        signal.throwIfAborted();
        const fileDecompressed = zstd.decompress(fileBuffer);
        fileProto = buf.fromBinary(pb.dashql.file.FileSchema, fileDecompressed);

        progress.fileDecompressingFinishedAt = new Date();
        progress.fileDecompressedByteCount = fileDecompressed.byteLength;
        progress.catalogCount = fileProto.catalogs.length;
        progress.notebookCount = fileProto.notebooks.length;
    } catch (e: any) {
        progress.fileDecompressingFailedAt = new Date();
        updateProgress({ ...progress });
        throw e;
    }

    progress.catalogLoadingStartedAt = progress.fileDecompressingFinishedAt;
    updateProgress({ ...progress });

    // The connection map
    const connMap = new Map<string, [number, ConnectionState]>();
    const notebookIds: number[] = [];

    try {
        // Setup connection catalogs
        for (const fileCatalog of fileProto.catalogs) {
            if (!fileCatalog.connectionParams) {
                continue;
            }
            // Compute signature
            const params = fileCatalog.connectionParams;
            const paramsSigObj = createConnectionParamsSignature(params);
            const paramsSig = JSON.stringify(paramsSigObj);

            // Allocate connection state
            let connState: ConnectionState | null = null;
            let prevConn = connMap.get(paramsSig);
            if (!prevConn) {
                connState = allocateConn(createConnectionStateFromParams(dql, params, connSigs));
                connMap.set(paramsSig, [connState.connectionId, connState]);
            } else {
                connState = prevConn[1];
            }

            // Add schema descriptors
            const catalogProto = decodeCatalogFromProto(fileCatalog);
            connState!.catalog.addSchemaDescriptorsT(CATALOG_DEFAULT_DESCRIPTOR_POOL, catalogProto);

            // Write to disk
            storage.write(groupCatalogWrites(connState.connectionId), {
                type: WRITE_CONNECTION_CATALOG,
                value: [connState.connectionId, connState!.catalog],
            });

            progress.catalogLoadingFinishedAt = new Date();
            progress.catalogsLoaded += 1;
            updateProgress({ ...progress });
        }
    } catch (e: any) {
        progress.catalogLoadingFailedAt = new Date();
        updateProgress({ ...progress });
        throw e;
    }

    progress.notebookLoadingStartedAt = new Date();
    updateProgress({ ...progress });

    try {
        // Setup notebook connections that are not covered by catalogs
        for (const notebook of fileProto.notebooks) {
            if (!notebook.connectionParams) {
                continue;
            }
            // Compute signature
            const paramsSigObj = createConnectionParamsSignature(notebook.connectionParams);
            const paramsSig = JSON.stringify(paramsSigObj);

            // Allocate connection state
            let connState: ConnectionState | null = null;
            let prevConn = connMap.get(paramsSig);
            if (!prevConn) {
                connState = allocateConn(createConnectionStateFromParams(dql, notebook.connectionParams, connSigs));
                connMap.set(paramsSig, [connState.connectionId, connState]);
            } else {
                connState = prevConn[1];
            }

            // Collect notebook scripts
            let notebookScripts = [...notebook.scripts];
            if (notebookScripts.length == 0) {
                notebookScripts.push(buf.create(pb.dashql.notebook.NotebookScriptSchema, {
                    scriptId: 1,
                    scriptText: "",
                }));
            }

            // Create the script registry
            const registry = dql.createScriptRegistry();

            // Collect notebook scripts
            let scripts: Record<number, ScriptData> = {};
            for (const script of notebook.scripts) {
                // Duplicate script key?
                const existingScript = scripts[script.scriptId];
                if (existingScript) {
                    continue;
                }

                // Create a script
                const s = dql.createScript(connState.catalog, script.scriptId);
                s.replaceText(script.scriptText);

                // Analyze every script
                // XXX Report progress
                const processed = analyzeScript(s);
                let statistics = Immutable.List<core.FlatBufferPtr<core.buffers.statistics.ScriptStatistics>>();
                statistics = statistics.push(s.getStatistics());

                // Allocate the script data
                scripts[script.scriptId] = {
                    scriptKey: script.scriptId,
                    script: s,
                    processed: processed,
                    annotations: buf.create(pb.dashql.notebook.NotebookScriptAnnotationsSchema),
                    outdatedAnalysis: false,
                    statistics: statistics,
                    cursor: null,
                    completion: null,
                    latestQueryId: null,
                };

                // Add to script registry
                registry.addScript(s);
            }

            // Use notebook_pages from loaded file; if empty, create one default page
            const notebookPages = notebook.notebookPages?.length
                ? notebook.notebookPages
                : [buf.create(pb.dashql.notebook.NotebookPageSchema, {
                    scripts: [buf.create(pb.dashql.notebook.NotebookPageScriptSchema, { scriptId: notebookScripts[0].scriptId, title: "" })]
                })];

            const notebookState = allocateNotebook({
                instance: dql,
                notebookMetadata: buf.create(pb.dashql.notebook.NotebookMetadataSchema, {
                    originalFileName: ""
                }),
                connectorInfo: connState.connectorInfo,
                connectionId: connState.connectionId,
                connectionCatalog: connState.catalog,
                scriptRegistry: registry,
                scripts,
                nextScriptKey: Math.max(...Object.keys(scripts).map(k => parseInt(k)), 0) + 1,
                notebookPages,
                selectedPageIndex: 0,
                selectedEntryInPage: 0,
                userFocus: null
            });
            notebookIds.push(notebookState.notebookId);

            console.log(notebookState);

            progress.notebookLoadingFinishedAt = new Date();
            progress.notebooksLoaded += 1;
            updateProgress({ ...progress });
        }
    } catch (e: any) {
        progress.notebookLoadingFailedAt = new Date();
        updateProgress({ ...progress });
        throw e;
    }

    progress.fileLoadingFinishedAt = new Date();
    updateProgress({ ...progress });

    return notebookIds;
}

interface StepProps {
    name: string;
    metric: string;
    startedAt: Date | null;
    finishedAt: Date | null;
    failedAt: Date | null;
}

function Step(props: StepProps) {
    let indicator: IndicatorStatus = IndicatorStatus.None;
    if (props.startedAt != null) {
        indicator = IndicatorStatus.Running;
    }
    if (props.finishedAt != null) {
        indicator = IndicatorStatus.Succeeded;
    }
    if (props.failedAt != null) {
        indicator = IndicatorStatus.Failed;
    }
    return (
        <div className={styles.steps_table}>
            <div className={styles.step_status}>
                <StatusIndicator
                    status={indicator}
                    fill="hsl(210deg, 12%, 16%)"
                    width="16px"
                    height="16px"
                />
            </div>
            <div className={styles.step_name}>
                {props.name}
            </div>
            <div className={styles.step_metric}>
                {props.metric}
            </div>
        </div>
    )
}

interface Props {
    file: PlatformFile;
    onDone: () => void;
}

export function FileLoader(props: Props) {
    const navigate = useRouterNavigate();
    const storageWriter = useStorageWriter();
    const coreSetup = useDashQLCoreSetup();
    const allocateConnection = useConnectionStateAllocator();
    const allocateNotebook = useNotebookStateAllocator();
    const [progress, setProgress] = React.useState<ProgressState | null>(null);
    const [connReg, _setConnReg] = useConnectionRegistry();
    const [notebookReg, _modifyNotebooks] = useNotebookRegistry();

    React.useEffect(() => {
        const proxiedSetProgress = (value: ProgressState | null) => {
            console.log(value);
            setProgress(value);
        };

        const abort = new AbortController();
        const runAsync = async () => {
            const notebookIds = await loadDashQLFile(props.file, coreSetup, allocateConnection, allocateNotebook, storageWriter, proxiedSetProgress, connReg.connectionsBySignature, abort.signal);
            if (notebookIds.length > 0) {
                const notebookId = notebookIds[0];
                const state = notebookReg.notebookMap.get(notebookId)!;
                navigate({
                    type: NOTEBOOK_PATH,
                    value: {
                        connectionId: state.connectionId,
                        notebookId: state.notebookId
                    }
                });
            }
            props.onDone();
        }
        runAsync();
        return () => abort.abort();

    }, [coreSetup, allocateNotebook, allocateConnection, props.file]);

    return (
        <div className={baseStyles.page} data-tauri-drag-region>
            <div className={classNames(baseStyles.banner_and_content_container, styles.banner_and_content_container)} data-tauri-drag-region>
                <div className={baseStyles.banner_container} data-tauri-drag-region>
                    <div className={baseStyles.banner_logo} data-tauri-drag-region>
                        <svg width="100%" height="100%">
                            <use xlinkHref={`${symbols}#dashql`} />
                        </svg>
                    </div>
                    <div className={baseStyles.banner_text_container} data-tauri-drag-region>
                        <div className={baseStyles.banner_title} data-tauri-drag-region>dashql</div>
                        <div className={baseStyles.app_version} data-tauri-drag-region>version {DASHQL_VERSION}</div>
                    </div>
                </div>
                <div className={baseStyles.content_container} data-tauri-drag-region>
                    <div className={baseStyles.card}>
                        <div className={baseStyles.card_header} data-tauri-drag-region>
                            <div className={baseStyles.card_header_left_container}>
                                Import
                            </div>
                        </div>
                        <div className={baseStyles.card_section}>
                            <div className={baseStyles.section_entries}>
                                <Step
                                    name="Read File"
                                    startedAt={progress?.fileReadingStartedAt ?? null}
                                    finishedAt={progress?.fileReadingFinishedAt ?? null}
                                    failedAt={progress?.fileReadingFailedAt ?? null}
                                    metric={formatBytes(progress?.fileByteCount ?? 0)}
                                />
                                <Step
                                    name="Decompress File"
                                    startedAt={progress?.fileDecompressingStartedAt ?? null}
                                    finishedAt={progress?.fileDecompressingFinishedAt ?? null}
                                    failedAt={progress?.fileDecompressingFailedAt ?? null}
                                    metric={formatBytes(progress?.fileDecompressedByteCount ?? 0)}
                                />
                                <Step
                                    name="Load Catalogs"
                                    startedAt={progress?.catalogLoadingStartedAt ?? null}
                                    finishedAt={progress?.catalogLoadingFinishedAt ?? null}
                                    failedAt={progress?.catalogLoadingFailedAt ?? null}
                                    metric={
                                        progress?.catalogsLoaded
                                            ? `${progress?.catalogsLoaded ?? 0} / ${progress?.catalogCount ?? 0}`
                                            : "-"
                                    }
                                />
                                <Step
                                    name="Load Notebooks"
                                    startedAt={progress?.notebookLoadingStartedAt ?? null}
                                    finishedAt={progress?.notebookLoadingFinishedAt ?? null}
                                    failedAt={progress?.notebookLoadingFailedAt ?? null}
                                    metric={
                                        progress?.notebooksLoaded
                                            ? `${progress?.notebooksLoaded ?? 0} / ${progress?.notebookCount ?? 0}`
                                            : "-"
                                    }
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

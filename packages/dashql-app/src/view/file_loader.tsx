import * as React from 'react';
import * as core from '@ankoh/dashql-core';
import * as pb from '@ankoh/dashql-protobuf';
import * as zstd from '../utils/zstd.js';

import * as symbols from '../../static/svg/symbols.generated.svg';
import * as baseStyles from './banner_page.module.css';
import * as styles from './file_loader.module.css';

import Immutable from 'immutable';

import { CATALOG_DEFAULT_DESCRIPTOR_POOL } from '../connection/catalog_update_state.js';
import { ConnectionAllocator, useConnectionRegistry, useConnectionStateAllocator } from '../connection/connection_registry.js';
import { ConnectionState } from '../connection/connection_state.js';
import { PlatformFile } from "../platform/file.js";
import { ScriptData, WorkbookEntry } from '../workbook/workbook_state.js';
import { ScriptLoadingStatus } from '../workbook/script_loader.js';
import { useWorkbookStateAllocator, WorkbookAllocator } from '../workbook/workbook_state_registry.js';
import { createConnectionParamsSignature, createConnectionStateFromParams, readConnectionParamsFromProto } from '../connection/connection_params.js';
import { decodeCatalogFileFromProto } from '../connection/catalog_import.js';
import { ScriptOriginType, ScriptType } from '../workbook/script_metadata.js';
import { DashQLSetupFn, useDashQLCoreSetup } from '../core_provider.js';
import { DASHQL_VERSION } from '../globals.js';
import { classNames } from '../utils/classnames.js';
import { IndicatorStatus, StatusIndicator } from './foundations/status_indicator.js';
import { formatBytes } from '../utils/format.js';
import { ConnectionSignatureMap } from '../connection/connection_signature.js';

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

    // The number of workbooks
    workbookCount: number | null;
    // The number of loaded workbooks
    workbooksLoaded: number;
    // The time when the loading of the first workbook started
    workbookLoadingStartedAt: Date | null;
    // The time when the loading of the last workbook finished
    workbookLoadingFinishedAt: Date | null;
    // The time when the loading of the last workbook failed
    workbookLoadingFailedAt: Date | null;

    // The time when the loading finished
    fileLoadingFinishedAt: Date | null;
}

type UpdateProgressFn = (state: ProgressState) => void;

async function loadDashQLFile(file: PlatformFile, dqlSetup: DashQLSetupFn, allocateConn: ConnectionAllocator, allocateWorkbook: WorkbookAllocator, updateProgress: UpdateProgressFn, connSigs: ConnectionSignatureMap, signal: AbortSignal) {
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

        workbookCount: null,
        workbooksLoaded: 0,
        workbookLoadingStartedAt: null,
        workbookLoadingFinishedAt: null,
        workbookLoadingFailedAt: null,

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
        fileProto = pb.dashql.file.File.fromBinary(fileDecompressed);

        progress.fileDecompressingFinishedAt = new Date();
        progress.fileDecompressedByteCount = fileDecompressed.byteLength;
        progress.catalogCount = fileProto.catalogs.length;
        progress.workbookCount = fileProto.workbooks.length;
    } catch (e: any) {
        progress.fileDecompressingFailedAt = new Date();
        updateProgress({ ...progress });
        throw e;
    }

    progress.catalogLoadingStartedAt = progress.fileDecompressingFinishedAt;
    updateProgress({ ...progress });

    // The connection map
    const connMap = new Map<string, [number, ConnectionState]>();
    const workbookIds: number[] = [];

    try {
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
            let connState: ConnectionState | null = null;
            let prevConn = connMap.get(paramsSig);
            if (!prevConn) {
                connState = allocateConn(createConnectionStateFromParams(dql, params, connSigs));
                connMap.set(paramsSig, [connState.connectionId, connState]);
            } else {
                connState = prevConn[1];
            }

            // Add schema descriptors
            const catalogProto = decodeCatalogFileFromProto(fileCatalog);
            connState!.catalog.addSchemaDescriptorsT(CATALOG_DEFAULT_DESCRIPTOR_POOL, catalogProto);

            progress.catalogLoadingFinishedAt = new Date();
            progress.catalogsLoaded += 1;
            updateProgress({ ...progress });
        }
    } catch (e: any) {
        progress.catalogLoadingFailedAt = new Date();
        updateProgress({ ...progress });
        throw e;
    }

    progress.workbookLoadingStartedAt = new Date();
    updateProgress({ ...progress });

    try {
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
            let connState: ConnectionState | null = null;
            let prevConn = connMap.get(paramsSig);
            if (!prevConn) {
                connState = allocateConn(createConnectionStateFromParams(dql, params, connSigs));
                connMap.set(paramsSig, [connState.connectionId, connState]);
            } else {
                connState = prevConn[1];
            }

            // Collect workbook scripts
            let workbookScripts = [...workbook.scripts];
            if (workbookScripts.length == 0) {
                workbookScripts.push(new pb.dashql.workbook.WorkbookScript({
                    scriptId: 1,
                    scriptType: pb.dashql.workbook.ScriptType.Query,
                    scriptText: "",
                }));
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
            if (workbook.workbookEntries.length == 0) {
                workbookEntries.push({
                    scriptKey: workbookScripts[0].scriptId,
                    queryId: null,
                    title: ""
                })
            }

            // Allocate workbook state
            const workbookState = allocateWorkbook({
                instance: dql,
                workbookMetadata: {
                    fileName: ""
                },
                connectorInfo: connState.connectorInfo,
                connectionId: connState.connectionId,
                connectionCatalog: connState.catalog,
                scripts,
                workbookEntries,
                selectedWorkbookEntry: 0,
                userFocus: null
            });
            workbookIds.push(workbookState.workbookId);

            console.log(workbookState);

            progress.workbookLoadingFinishedAt = new Date();
            progress.workbooksLoaded += 1;
            updateProgress({ ...progress });
        }
    } catch (e: any) {
        progress.workbookLoadingFailedAt = new Date();
        updateProgress({ ...progress });
        throw e;
    }

    progress.fileLoadingFinishedAt = new Date();
    updateProgress({ ...progress });
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
    const dqlSetup = useDashQLCoreSetup();
    const allocateConnection = useConnectionStateAllocator();
    const allocateWorkbook = useWorkbookStateAllocator();
    const [progress, setProgress] = React.useState<ProgressState | null>(null);
    const [reg, _setReg] = useConnectionRegistry();

    React.useEffect(() => {
        const proxiedSetProgress = (value: ProgressState | null) => {
            console.log(value);
            setProgress(value);
        };

        const abort = new AbortController();
        const runAsync = async () => {
            await loadDashQLFile(props.file, dqlSetup, allocateConnection, allocateWorkbook, proxiedSetProgress, reg.connectionsBySignature, abort.signal);
            props.onDone();
        }
        runAsync();
        return () => abort.abort();

    }, [dqlSetup, allocateWorkbook, allocateConnection, props.file]);

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
                                    name="Load Workbooks"
                                    startedAt={progress?.workbookLoadingStartedAt ?? null}
                                    finishedAt={progress?.workbookLoadingFinishedAt ?? null}
                                    failedAt={progress?.workbookLoadingFailedAt ?? null}
                                    metric={
                                        progress?.workbooksLoaded
                                            ? `${progress?.workbooksLoaded ?? 0} / ${progress?.workbookCount ?? 0}`
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

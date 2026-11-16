import * as React from 'react';

import type * as core from '@akohn/dashql';

import { PlatformFile } from '../platform/file/file.js';
import { importedWorkbook, useWorkbookImport, type ConflictChoice, type PreparedImport, type WorkbookImportProgress } from '../workbook/persistence/workbook_import_provider.js';
import { WorkbookImportCard, type WorkbookFileStepStatus, type WorkbookImportCardDependencies } from '../workbook/persistence/workbook_import_card.js';
import { IndicatorStatus } from '../ui/foundations/status_indicator.js';
import { OPEN_LINK_WORKBOOK, useRouterNavigate } from './router.js';
import { useLogger } from '../platform/logger_provider.js';
import { stringifyError, type LoggerLike } from '@akohn/dashql/platform/logger/logger';

/// The stages of a file before the user decides
type PreparationPhase = 'reading' | 'validating' | 'resolving';

/// The steps that a commit of the import reports, in order
const COMMIT_STEPS = ['results', 'workbook'] as const;
type CommitStep = typeof COMMIT_STEPS[number];

/// How far the commit of an import got
interface ImportProgress {
    /// The step that runs
    step: CommitStep;
    /// The outcome of the query results, once they were added
    results: core.ImportedResults | null;
}

type FileLoadState =
    | { phase: 'reading' }
    | { phase: 'validating'; fileByteCount: number }
    /// The archive is fine, the connections of its workbook are resolved, the user may be asked
    | { phase: 'resolving'; preview: core.ImportPreview; fileByteCount: number }
    /// Every decision but the import itself is made
    | { phase: 'ready'; prepared: PreparedImport; preview: core.ImportPreview; fileByteCount: number }
    | { phase: 'importing'; prepared: PreparedImport; preview: core.ImportPreview; fileByteCount: number; progress: ImportProgress }
    /// Imported, but some query results weren't added. The card stays until the user opens the workbook.
    | { phase: 'imported'; preview: core.ImportPreview; fileByteCount: number; workbookId: string; results: core.ImportedResults }
    | {
        phase: 'failed'; failedPhase: PreparationPhase | 'importing'; error: Error; fileByteCount: number | null;
        preview: core.ImportPreview | null; progress: ImportProgress | null;
    };

export interface FileLoaderDependencies {
    workbookImportCard?: WorkbookImportCardDependencies;
    useWorkbookImport(): Pick<ReturnType<typeof useWorkbookImport>, 'readImport' | 'prepareImport' | 'commitImport' | 'dropImport'>;
    useRouterNavigate: typeof useRouterNavigate;
    useLogger?: () => LoggerLike | null;
}

const DEFAULT_DEPENDENCIES: FileLoaderDependencies = {
    useWorkbookImport,
    useRouterNavigate,
    useLogger,
};

const LOG_CTX = 'file_loader';

interface Props {
    file: PlatformFile;
    onDone(): void;
    dependencies?: FileLoaderDependencies;
}

export function FileLoader({ file, onDone, dependencies = DEFAULT_DEPENDENCIES }: Props): React.ReactElement {
    const navigate = dependencies.useRouterNavigate();
    const logger = (dependencies.useLogger ?? (() => null))();
    const { readImport, prepareImport, commitImport, dropImport } = dependencies.useWorkbookImport();
    const [attempt, setAttempt] = React.useState(0);
    const [state, setState] = React.useState<FileLoadState>({ phase: 'reading' });
    const prepareFile = React.useEffectEvent(async (input: PlatformFile, signal: AbortSignal) => {
        try {
            setState({ phase: 'reading' });
            // A dropped file is read in place, the query results it carries stay on disk until the import streams them
            const zipBlob = input.blob ?? new Blob([await input.readAsArrayBuffer() as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
            signal.throwIfAborted();

            setState({ phase: 'validating', fileByteCount: zipBlob.size });
            const preview = await readImport({ archive: zipBlob });
            if (signal.aborted) {
                dropImport(preview);
                return;
            }
            logger?.info('Read a workbook file', {
                file: input.path, bytes: zipBlob.size.toString(), inPlace: (input.blob != null).toString(),
                scripts: preview.scriptCount.toString(), connections: importedWorkbook(preview).connections.length.toString(),
                results: preview.results.count.toString(), resultBytes: preview.results.bytes.toString(),
            }, LOG_CTX);

            // The connections are resolved right away, the user may be asked which existing connections to use
            setState({ phase: 'resolving', preview, fileByteCount: zipBlob.size });
            const prepared = await prepareImport(preview);
            if (prepared == null) {
                logger?.info('Cancelled the import of a workbook file while resolving its connections', { file: input.path }, LOG_CTX);
                if (!signal.aborted) onDone();
                return;
            }
            if (signal.aborted) {
                dropImport(preview);
                return;
            }
            setState({ phase: 'ready', prepared, preview, fileByteCount: zipBlob.size });
        } catch (error) {
            if (signal.aborted) return;
            logger?.warn('Preparing a workbook file failed', { file: input.path, error: stringifyError(error) }, LOG_CTX);
            setState(current => ({
                phase: 'failed',
                failedPhase: current.phase === 'validating' || current.phase === 'resolving' ? current.phase : 'reading',
                error: toError(error),
                fileByteCount: 'fileByteCount' in current ? current.fileByteCount : null,
                preview: 'preview' in current ? current.preview : null,
                progress: null,
            }));
        }
    });

    React.useEffect(() => {
        const abortController = new AbortController();
        void prepareFile(file, abortController.signal);
        return () => abortController.abort();
    }, [file, attempt]);

    const requestClose = React.useCallback(() => {
        if (state.phase === 'importing') return;
        // A file that the user doesn't import lets go of its import
        if (state.phase === 'ready') dropImport(state.preview);
        onDone();
    }, [dropImport, onDone, state]);
    const retry = React.useCallback(() => setAttempt(value => value + 1), []);
    const openImported = React.useCallback(() => {
        if (state.phase !== 'imported') return;
        navigate({ type: OPEN_LINK_WORKBOOK, value: state.workbookId });
        onDone();
    }, [navigate, onDone, state]);
    const startImport = React.useEffectEvent(async (prepared: PreparedImport, fileByteCount: number, choice: ConflictChoice | null) => {
        const preview = prepared.preview;
        let progress: ImportProgress = { step: preview.results.count > 0 ? 'results' : 'workbook', results: null };
        const onProgress = (update: WorkbookImportProgress) => {
            // The file shows the commit as adding the results and saving the workbook
            if (update.step !== 'results' && update.step !== 'workbook') return;
            progress = { step: update.step, results: update.step === 'results' ? update.outcome : progress.results };
            setState(current => current.phase === 'importing' ? { ...current, progress } : current);
        };
        setState({ phase: 'importing', prepared, preview, fileByteCount, progress });
        try {
            const workbookId = await commitImport(prepared, choice, { onProgress });
            // Query results that weren't added are shown before the workbook opens, their scripts need a connection
            const results = progress.results;
            if (results != null && missingResults(results) > 0) {
                logger?.info('Kept the import card open, some query results were not added', {
                    file: file.path, workbookId, results: results.total.toString(), missing: missingResults(results).toString(),
                }, LOG_CTX);
                setState({ phase: 'imported', preview, fileByteCount, workbookId, results });
                return;
            }
            navigate({ type: OPEN_LINK_WORKBOOK, value: workbookId });
            onDone();
        } catch (error) {
            logger?.warn('Importing a workbook file failed', { file: file.path, step: progress.step, error: stringifyError(error) }, LOG_CTX);
            setState({
                phase: 'failed',
                failedPhase: 'importing',
                error: toError(error),
                fileByteCount,
                preview,
                progress,
            });
        }
    });
    const requestImport = React.useCallback((choice: ConflictChoice | null) => {
        if (state.phase === 'ready') void startImport(state.prepared, state.fileByteCount, choice);
    }, [state]);

    const steps = fileImportSteps(state);
    const card = dependencies.workbookImportCard;
    switch (state.phase) {
        case 'reading':
            return <WorkbookImportCard phase="file-loading" sourcePath={file.path} stage="reading" steps={steps} fileByteCount={null} preview={null} onClose={requestClose} dependencies={card} />;
        case 'validating':
            return <WorkbookImportCard phase="file-loading" sourcePath={file.path} stage="validating" steps={steps} fileByteCount={state.fileByteCount} preview={null} onClose={requestClose} dependencies={card} />;
        case 'resolving':
            return <WorkbookImportCard phase="file-loading" sourcePath={file.path} stage="resolving" steps={steps} fileByteCount={state.fileByteCount} preview={state.preview} onClose={requestClose} dependencies={card} />;
        case 'ready':
        case 'importing':
            return <WorkbookImportCard phase="file-ready" sourcePath={file.path} fileByteCount={state.fileByteCount} preview={state.preview} steps={steps}
                conflict={state.prepared.conflict} busy={state.phase === 'importing'}
                onImport={() => requestImport(null)} onReplace={() => requestImport('replace')} onCreateNew={() => requestImport('create-new')}
                onClose={requestClose} dependencies={card} />;
        case 'imported':
            return <WorkbookImportCard phase="file-imported" sourcePath={file.path} fileByteCount={state.fileByteCount}
                preview={state.preview} steps={steps} warning={resultsWarning(state.results)} warningDetail={state.results.error}
                onOpen={openImported} onClose={requestClose} dependencies={card} />;
        case 'failed':
            return <WorkbookImportCard phase="file-error" sourcePath={file.path} fileByteCount={state.fileByteCount} preview={state.preview} steps={steps}
                failedStage={state.failedPhase} errorMessage={state.error.message} onRetry={retry} onClose={requestClose} dependencies={card} />;
    }
}

/// The query results of an import that aren't in the cache
function missingResults(results: core.ImportedResults): number {
    return results.failed + results.dropped;
}

/// Why some query results of an imported workbook aren't in the cache
function resultsWarning(results: core.ImportedResults): string {
    const missing = missingResults(results);
    const reasons = [
        results.failed > 0 ? `${results.failed} failed` : null,
        results.dropped > 0 ? `${results.dropped} did not fit into the cache` : null,
    ].filter(reason => reason != null).join(', ');
    return `${missing} of ${results.total} query ${results.total === 1 ? 'result' : 'results'} ${missing === 1 ? 'was' : 'were'} not added to the cache (${reasons}). `
        + `Their scripts need a connection to run.`;
}

/// The status of a step before, at and after the step that runs
function stepStatus(index: number, reached: number, failed: boolean): IndicatorStatus {
    return index < reached ? IndicatorStatus.Succeeded
        : index > reached ? IndicatorStatus.None
            : failed ? IndicatorStatus.Failed : IndicatorStatus.Running;
}

/// The steps of the import of a file, like the steps of the setup of the app. The file is read, its archive checked and
/// its connections resolved before the user imports it. The query results are a step only if the file has some.
function fileImportSteps(state: FileLoadState): WorkbookFileStepStatus[] {
    const failed = state.phase === 'failed';
    const failedAt = failed ? state.failedPhase : null;
    // How far the preparation got, the stage that runs or failed
    const preparation: PreparationPhase[] = ['reading', 'validating', 'resolving'];
    const prepared = state.phase === 'reading' || state.phase === 'validating' || state.phase === 'resolving'
        ? preparation.indexOf(state.phase)
        : failedAt != null && failedAt !== 'importing' ? preparation.indexOf(failedAt) : preparation.length;
    const steps: WorkbookFileStepStatus[] = [
        { step: 'read', status: stepStatus(0, prepared, failed) },
        { step: 'check', status: stepStatus(1, prepared, failed) },
    ];
    const preview = 'preview' in state ? state.preview : null;
    if (preview == null) return steps;
    steps.push({ step: 'connections', status: stepStatus(2, prepared, failed) });

    // How far the commit got: the step that runs or failed, all steps once imported, none before
    const progress = state.phase === 'importing' || state.phase === 'failed' ? state.progress : null;
    const reached = state.phase === 'imported' ? COMMIT_STEPS.length : progress == null ? -1 : COMMIT_STEPS.indexOf(progress.step);
    const results = state.phase === 'imported' ? state.results : progress?.results ?? null;
    const resultCount = preview.results.count;
    COMMIT_STEPS.forEach((step, index) => {
        if (step === 'results' && resultCount === 0) return;
        let status = stepStatus(index, reached, failed);
        let detail: string | null = null;
        if (step === 'results') {
            detail = `${resultCount} ${resultCount === 1 ? 'result' : 'results'}`;
            if (results != null) {
                // The results are added, the outcome tells if all of them are in the cache
                detail = `${results.added + results.kept} of ${results.total}`;
                status = missingResults(results) > 0 ? IndicatorStatus.Failed : IndicatorStatus.Succeeded;
            }
        }
        steps.push({ step, status, detail });
    });
    return steps;
}

function toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

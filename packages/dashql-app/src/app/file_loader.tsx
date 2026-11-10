import * as React from 'react';

import { PlatformFile } from '../platform/file/file.js';
import type { SessionBundle } from '../storage/session_bundle.js';
import { readSessionBundleFromZip } from '../session/persistence/session_import.js';
import { useSessionImport } from '../session/persistence/session_import_provider.js';
import { SessionImportCard, type SessionImportCardDependencies } from '../session/persistence/session_import_card.js';
import { OPEN_LINK_SESSION, useRouterNavigate } from './router/router.js';
import { useLogger } from '../platform/logger/logger_provider.js';
import { stringifyError, type LoggerLike } from '../platform/logger/logger.js';

type PreparationPhase = 'reading' | 'validating';

type FileLoadState =
    | { phase: 'reading' }
    | { phase: 'validating'; fileByteCount: number }
    | { phase: 'ready'; bundle: SessionBundle; fileByteCount: number }
    | { phase: 'importing'; bundle: SessionBundle; fileByteCount: number }
    | { phase: 'failed'; failedPhase: PreparationPhase | 'importing'; error: Error; fileByteCount: number | null };

export interface FileLoaderDependencies {
    sessionImportCard?: SessionImportCardDependencies;
    readSessionBundleFromZip: typeof readSessionBundleFromZip;
    useSessionImport(): Pick<ReturnType<typeof useSessionImport>, 'importPortableBundle'>;
    useRouterNavigate: typeof useRouterNavigate;
    useLogger?: () => LoggerLike | null;
}

const DEFAULT_DEPENDENCIES: FileLoaderDependencies = {
    readSessionBundleFromZip,
    useSessionImport,
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
    const { importPortableBundle } = dependencies.useSessionImport();
    const [attempt, setAttempt] = React.useState(0);
    const [state, setState] = React.useState<FileLoadState>({ phase: 'reading' });
    const prepareFile = React.useEffectEvent(async (input: PlatformFile, signal: AbortSignal) => {
        try {
            setState({ phase: 'reading' });
            // A dropped file is read in place, the query results it carries stay on disk until the import streams them
            const zipBlob = input.blob ?? new Blob([await input.readAsArrayBuffer() as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
            signal.throwIfAborted();

            setState({ phase: 'validating', fileByteCount: zipBlob.size });
            const bundle = await dependencies.readSessionBundleFromZip(zipBlob);
            signal.throwIfAborted();
            const results = bundle.results ?? [];
            logger?.info('Read a session file', {
                file: input.path, bytes: zipBlob.size.toString(), inPlace: (input.blob != null).toString(),
                scripts: bundle.scripts.length.toString(), connections: bundle.session.connections.length.toString(),
                results: results.length.toString(), resultBytes: results.reduce((sum, result) => sum + result.bytes.size, 0).toString(),
            }, LOG_CTX);

            setState({ phase: 'ready', bundle, fileByteCount: zipBlob.size });
        } catch (error) {
            if (signal.aborted) return;
            logger?.warn('Reading a session file failed', { file: input.path, error: stringifyError(error) }, LOG_CTX);
            setState(current => ({
                phase: 'failed',
                failedPhase: current.phase === 'validating' ? 'validating' : 'reading',
                error: toError(error),
                fileByteCount: 'fileByteCount' in current ? current.fileByteCount : null,
            }));
        }
    });

    React.useEffect(() => {
        const abortController = new AbortController();
        void prepareFile(file, abortController.signal);
        return () => abortController.abort();
    }, [file, attempt]);

    const requestClose = React.useCallback(() => {
        if (state.phase !== 'importing') onDone();
    }, [onDone, state.phase]);
    const retry = React.useCallback(() => setAttempt(value => value + 1), []);
    const startImport = React.useEffectEvent(async (bundle: SessionBundle, fileByteCount: number) => {
        setState({ phase: 'importing', bundle, fileByteCount });
        try {
            const sessionId = await importPortableBundle(bundle, {
                presentation: { mode: 'centered' },
            });
            if (sessionId == null) {
                setState({ phase: 'ready', bundle, fileByteCount });
                return;
            }
            navigate({ type: OPEN_LINK_SESSION, value: sessionId });
            onDone();
        } catch (error) {
            setState({
                phase: 'failed',
                failedPhase: 'importing',
                error: toError(error),
                fileByteCount,
            });
        }
    });
    const requestImport = React.useCallback(() => {
        if (state.phase === 'ready') void startImport(state.bundle, state.fileByteCount);
    }, [state]);

    switch (state.phase) {
        case 'reading':
            return <SessionImportCard phase="file-loading" sourcePath={file.path} stage="reading" fileByteCount={null} onClose={requestClose} dependencies={dependencies.sessionImportCard} />;
        case 'validating':
            return <SessionImportCard phase="file-loading" sourcePath={file.path} stage="validating" fileByteCount={state.fileByteCount} onClose={requestClose} dependencies={dependencies.sessionImportCard} />;
        case 'ready':
            return <SessionImportCard phase="file-ready" sourcePath={file.path} fileByteCount={state.fileByteCount}
                bundle={state.bundle} busy={false} onImport={requestImport} onClose={requestClose} dependencies={dependencies.sessionImportCard} />;
        case 'importing':
            return <SessionImportCard phase="file-ready" sourcePath={file.path} fileByteCount={state.fileByteCount}
                bundle={state.bundle} busy onImport={requestImport} onClose={requestClose} dependencies={dependencies.sessionImportCard} />;
        case 'failed':
            return <SessionImportCard phase="file-error" sourcePath={file.path} fileByteCount={state.fileByteCount}
                failedStage={state.failedPhase} errorMessage={state.error.message} onRetry={retry} onClose={requestClose} dependencies={dependencies.sessionImportCard} />;
    }
}

function toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

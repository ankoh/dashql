import * as React from 'react';

import { PlatformFile } from '../../platform/file/file.js';
import type { NotebookBundle } from '../notebook/persistence/notebook_bundle.js';
import { readNotebookBundleFromZip } from '../notebook/persistence/notebook_import.js';
import { useNotebookImport } from '../notebook/persistence/notebook_import_provider.js';
import { NotebookImportCard } from '../notebook/ui/notebook_import_card.js';
import { OPEN_LINK_NOTEBOOK, useRouterNavigate } from '../router/router.js';

type PreparationPhase = 'reading' | 'validating';

type FileLoadState =
    | { phase: 'reading' }
    | { phase: 'validating'; fileByteCount: number }
    | { phase: 'ready'; bundle: NotebookBundle; fileByteCount: number }
    | { phase: 'importing'; bundle: NotebookBundle; fileByteCount: number }
    | { phase: 'failed'; failedPhase: PreparationPhase | 'importing'; error: Error; fileByteCount: number | null };

interface Props {
    file: PlatformFile;
    onDone(): void;
}

export function FileLoader({ file, onDone }: Props): React.ReactElement {
    const navigate = useRouterNavigate();
    const { importPortableBundle } = useNotebookImport();
    const [attempt, setAttempt] = React.useState(0);
    const [state, setState] = React.useState<FileLoadState>({ phase: 'reading' });
    const prepareFile = React.useEffectEvent(async (input: PlatformFile, signal: AbortSignal) => {
        try {
            setState({ phase: 'reading' });
            const bytes = await input.readAsArrayBuffer();
            signal.throwIfAborted();

            setState({ phase: 'validating', fileByteCount: bytes.byteLength });
            const zipBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
            const zipBlob = new Blob([zipBuffer], { type: 'application/zip' });
            const bundle = await readNotebookBundleFromZip(zipBlob);
            signal.throwIfAborted();

            setState({ phase: 'ready', bundle, fileByteCount: bytes.byteLength });
        } catch (error) {
            if (signal.aborted) return;
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
    const startImport = React.useEffectEvent(async (bundle: NotebookBundle, fileByteCount: number) => {
        setState({ phase: 'importing', bundle, fileByteCount });
        try {
            const notebookId = await importPortableBundle(bundle, {
                presentation: { mode: 'centered' },
            });
            if (notebookId == null) {
                setState({ phase: 'ready', bundle, fileByteCount });
                return;
            }
            navigate({ type: OPEN_LINK_NOTEBOOK, value: notebookId });
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
            return <NotebookImportCard phase="file-loading" sourcePath={file.path} stage="reading" fileByteCount={null} onClose={requestClose} />;
        case 'validating':
            return <NotebookImportCard phase="file-loading" sourcePath={file.path} stage="validating" fileByteCount={state.fileByteCount} onClose={requestClose} />;
        case 'ready':
            return <NotebookImportCard phase="file-ready" sourcePath={file.path} fileByteCount={state.fileByteCount}
                bundle={state.bundle} busy={false} onImport={requestImport} onClose={requestClose} />;
        case 'importing':
            return <NotebookImportCard phase="file-ready" sourcePath={file.path} fileByteCount={state.fileByteCount}
                bundle={state.bundle} busy onImport={requestImport} onClose={requestClose} />;
        case 'failed':
            return <NotebookImportCard phase="file-error" sourcePath={file.path} fileByteCount={state.fileByteCount}
                failedStage={state.failedPhase} errorMessage={state.error.message} onRetry={retry} onClose={requestClose} />;
    }
}

function toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

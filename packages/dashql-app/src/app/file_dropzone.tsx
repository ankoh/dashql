import * as React from 'react';
import * as styles from './file_dropzone.module.css';

import { FileLoader, type FileLoaderDependencies } from './file_loader.js';
import { FlavorLogo } from '../config/flavor_provider.js';
import { FileDropHandlers, type FileDropHandler } from './file_drop_handler.js';

/// A drag stops when no drag over event follows within this time
const DRAG_TIMEOUT = 100;

function FileDropzoneArea() {
    return (
        <div className={styles.area_centered} data-testid="file-dropzone-area">
            <div className={styles.area_container}>
                <div className={styles.area_logo}>
                    <FlavorLogo width={180} />
                </div>
            </div>
        </div>
    );
}

/// Shows the dropzone over the app while a file is dragged over the window. A drop goes to the handlers first, the
/// dropzone loads the first file of a drop that none of them takes.
export function FileDropzone(props: { children: React.ReactElement; fileLoader?: FileLoaderDependencies }) {
    const [droppedFile, setDroppedFile] = React.useState<File | null>(null);
    const [dragOngoing, setDragOngoing] = React.useState(false);
    const [handlers] = React.useState(() => new Set<React.RefObject<FileDropHandler | null>>());

    // The listeners capture the events, so that the stale listeners of a hot reload don't process the same file
    React.useEffect(() => {
        let dragTimeout: ReturnType<typeof setTimeout> | null = null;
        const clearDragTimeout = () => {
            if (dragTimeout == null) return;
            clearTimeout(dragTimeout);
            dragTimeout = null;
        };
        const onDragOver = (event: DragEvent) => {
            event.preventDefault();
            clearDragTimeout();
            setDragOngoing(true);
            dragTimeout = setTimeout(() => {
                dragTimeout = null;
                setDragOngoing(false);
            }, DRAG_TIMEOUT);
        };
        const onDragEnd = (event: DragEvent) => {
            event.preventDefault();
            clearDragTimeout();
            setDragOngoing(false);
        };
        const onDrop = (event: DragEvent) => {
            event.preventDefault();
            event.stopImmediatePropagation();
            clearDragTimeout();
            setDragOngoing(false);
            const dropped = event.dataTransfer?.files;
            const files: File[] = [];
            for (let i = 0; i < (dropped?.length ?? 0); ++i) {
                const file = dropped!.item(i);
                if (file != null) files.push(file);
            }
            if (files.length === 0) return;
            for (const handler of [...handlers].reverse()) {
                if (handler.current?.(files) === true) return;
            }
            setDroppedFile(files[0]);
        };
        window.addEventListener('dragover', onDragOver, true);
        window.addEventListener('dragend', onDragEnd, true);
        window.addEventListener('drop', onDrop, true);
        return () => {
            window.removeEventListener('dragover', onDragOver, true);
            window.removeEventListener('dragend', onDragEnd, true);
            window.removeEventListener('drop', onDrop, true);
            clearDragTimeout();
        };
    }, [handlers]);

    // On-done handler to close the dropzone again
    const closeDropzone = React.useCallback(() => {
        setDroppedFile(null);
    }, []);

    // The app stays mounted under the dropzone, its handlers take the drop
    return (
        <FileDropHandlers.Provider value={handlers}>
            <div className={styles.root}>
                {droppedFile != null
                    ? <FileLoader file={droppedFile} onDone={closeDropzone} dependencies={props.fileLoader} />
                    : props.children}
                {droppedFile == null && dragOngoing && <FileDropzoneArea />}
            </div>
        </FileDropHandlers.Provider>
    );
}

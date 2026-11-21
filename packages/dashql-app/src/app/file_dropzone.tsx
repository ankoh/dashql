import * as React from 'react';
import * as styles from './file_dropzone.module.css';

import { FileLoader, type FileLoaderDependencies } from './file_loader.js';
import { FlavorLogo } from '../config/flavor_provider.js';

/// A drag stops when no drag over event follows within this time
const DRAG_TIMEOUT = 100;

function FileDropzoneArea() {
    return (
        <div className={styles.area_centered}>
            <div className={styles.area_container}>
                <div className={styles.area_logo}>
                    <FlavorLogo width={180} />
                </div>
            </div>
        </div>
    );
}

/// Shows the dropzone while a file is dragged over the window and loads the first dropped file
export function FileDropzone(props: { children: React.ReactElement; fileLoader?: FileLoaderDependencies }) {
    const [droppedFile, setDroppedFile] = React.useState<File | null>(null);
    const [dragOngoing, setDragOngoing] = React.useState(false);

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
            const file = event.dataTransfer?.files.item(0);
            if (file != null) setDroppedFile(file);
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
    }, []);

    // On-done handler to close the dropzone again
    const closeDropzone = React.useCallback(() => {
        setDroppedFile(null);
    }, []);

    // Determine content
    let content: React.ReactElement = props.children;
    if (droppedFile != null) {
        content = <FileLoader file={droppedFile} onDone={closeDropzone} dependencies={props.fileLoader} />;
    } else if (dragOngoing) {
        content = <FileDropzoneArea />;
    }
    return (
        <div className={styles.root}>
            {content}
        </div>
    );
}

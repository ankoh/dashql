import * as React from 'react';
import * as styles from './file_dropzone.module.css';
import * as symbols from '../../static/svg/symbols.generated.svg';

import { DRAG_EVENT, DRAG_STOP_EVENT, DROP_EVENT, PlatformDragDropEventVariant } from '../platform/event.js';
import { PlatformFile } from '../platform/file.js';
import { usePlatformEventListener } from '../platform/event_listener_provider.js';
import { useLogger } from '../platform/logger_provider.js';
import { FileLoader } from './file_loader.js';

function FileDropzoneArea() {
    return (
        <div className={styles.area_centered}>
            <div className={styles.area_container}>
                <div className={styles.area_logo}>
                    <svg width="180px" height="180px">
                        <use xlinkHref={`${symbols}#dashql`} />
                    </svg>
                </div>
            </div>
        </div>
    );
}

export function FileDropzone(props: { children: React.ReactElement }) {
    const _logger = useLogger();
    const appEvents = usePlatformEventListener();
    const [droppedFile, setDroppedFile] = React.useState<PlatformFile | null>(null);
    const [dragOngoing, setDragOngoing] = React.useState<Date | null>(null);

    // Callback to drop file
    const onDropFile = React.useCallback(async (file: PlatformFile) => setDroppedFile(file), []);
    // Callback for drag/drop events
    const onDragDrop = React.useCallback((event: PlatformDragDropEventVariant) => {
        switch (event.type) {
            case DRAG_EVENT:
                setDragOngoing(new Date());
                break;
            case DRAG_STOP_EVENT:
                setDragOngoing(null);
                break;
            case DROP_EVENT: {
                onDropFile(event.value.file);
                setDragOngoing(null);
                break;
            }
        }
    }, []);

    // Subscribe drag/drop events
    React.useEffect(() => {
        appEvents.subscribeDragDropEvents("dropzone", onDragDrop);
        return () => appEvents.unsubscribeDragDropEvents("dropzone");
    }, [appEvents, onDragDrop]);

    // On-done handler to close the dropzone again
    const closeDropzone = React.useCallback(() => {
        setDroppedFile(null);
    }, []);

    // Determine content
    let content: React.ReactElement = props.children;
    if (droppedFile != null) {
        content = <FileLoader file={droppedFile} onDone={closeDropzone} />;
    } else if (dragOngoing) {
        content = <FileDropzoneArea />;
    }
    return (
        <div className={styles.root}>
            {content}
        </div>
    );
}

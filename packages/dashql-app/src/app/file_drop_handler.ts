import * as React from 'react';

/// Takes the files of a drop before the dropzone loads them as a workbook, returns whether it took them
export type FileDropHandler = (files: File[]) => boolean;

export const FileDropHandlers = React.createContext<Set<React.RefObject<FileDropHandler | null>> | null>(null);

/// Offer the files dropped on the window to a handler, e.g. the Parquet files to the open workbook as attachments.
/// The latest handler goes first, a null handler takes nothing.
export function useFileDropHandler(handler: FileDropHandler | null): void {
    const handlers = React.useContext(FileDropHandlers);
    const handlerRef = React.useRef(handler);
    handlerRef.current = handler;
    React.useEffect(() => {
        if (handlers == null) return;
        handlers.add(handlerRef);
        return () => { handlers.delete(handlerRef); };
    }, [handlers]);
}

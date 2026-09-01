import * as React from 'react';

import { useDynamicRowHeight, useListRef } from 'react-window';

import { observeSize } from '../../../../ui/foundations/size_observer.js';
import { useScrollbarWidth } from '../../../../utils/scrollbar.js';

export interface FeedScrollTarget {
    fileName: string;
    version: number;
}

interface FeedLayoutEntry {
    fileName: string;
    scriptId: number;
}

export function useNotebookFeedLayout(
    entries: FeedLayoutEntry[],
    scrollTarget: FeedScrollTarget | null | undefined,
) {
    const listContainerRef = React.useRef<HTMLDivElement>(null);
    const listRef = useListRef(null);
    const rowHeights = useDynamicRowHeight({ defaultRowHeight: 240 });
    const listContainerSize = observeSize(listContainerRef);
    const listWidth = listContainerSize?.width ?? 0;
    const listHeight = listContainerSize?.height ?? 0;
    const listScrollbarInset = useScrollbarWidth();

    const entriesRef = React.useRef(entries);
    entriesRef.current = entries;
    React.useEffect(() => {
        if (scrollTarget == null || !listRef.current) return;
        const currentEntries = entriesRef.current;
        if (currentEntries.length === 0) return;
        if (scrollTarget.fileName === '') {
            listRef.current.scrollToRow({ index: 0, align: 'start' });
            return;
        }
        const targetIndex = currentEntries.findIndex(entry => entry.fileName === scrollTarget.fileName);
        if (targetIndex < 0) return;
        listRef.current.scrollToRow({ index: targetIndex * 2 + 1, align: 'start' });
    }, [listRef, scrollTarget]);

    return {
        listContainerRef,
        listRef,
        rowHeights,
        listWidth,
        listHeight,
        listScrollbarInset,
    };
}

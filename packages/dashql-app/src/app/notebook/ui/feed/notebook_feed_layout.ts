import * as React from 'react';

import { useListRef } from 'react-window';

import { observeSize } from '../../../../ui/foundations/size_observer.js';
import { useScrollbarWidth } from '../../../../utils/scrollbar.js';

export interface FeedScrollTarget {
    fileName: string;
    version: number;
}

interface FeedLayoutEntry {
    fileName: string;
    scriptId: number;
    estimatedHeight: number;
}

const SEPARATOR_HEIGHT = 40;
const FIRST_SEPARATOR_HEIGHT = 48;

export class FeedRowHeightCache {
    private readonly measuredHeights = new Map<number, number>();

    constructor(
        private entries: FeedLayoutEntry[],
        private readonly onChange: (index: number, previousHeight: number, height: number) => void = () => {},
    ) {}

    updateEntries(entries: FeedLayoutEntry[]) {
        this.entries = entries;
    }

    getAverageRowHeight() {
        if (this.entries.length === 0) return SEPARATOR_HEIGHT;
        const totalEntryHeight = this.entries.reduce((total, entry) => (
            total + (this.measuredHeights.get(entry.scriptId) ?? entry.estimatedHeight)
        ), 0);
        const totalSeparatorHeight = FIRST_SEPARATOR_HEIGHT + this.entries.length * SEPARATOR_HEIGHT;
        return (totalEntryHeight + totalSeparatorHeight) / (this.entries.length * 2 + 1);
    }

    getRowHeight(index: number) {
        if (index % 2 === 0) return index === 0 ? FIRST_SEPARATOR_HEIGHT : SEPARATOR_HEIGHT;
        const entry = this.entries[Math.floor(index / 2)];
        return entry == null ? undefined : this.measuredHeights.get(entry.scriptId) ?? entry.estimatedHeight;
    }

    getRowOffset(index: number) {
        let offset = 0;
        for (let rowIndex = 0; rowIndex < index; rowIndex += 1) {
            offset += this.getRowHeight(rowIndex) ?? 0;
        }
        return offset;
    }

    setRowHeight = (index: number, height: number) => {
        const entry = index % 2 === 1 ? this.entries[Math.floor(index / 2)] : null;
        if (entry == null) return;
        const previousHeight = this.measuredHeights.get(entry.scriptId) ?? entry.estimatedHeight;
        if (previousHeight === height) return;
        this.measuredHeights.set(entry.scriptId, height);
        this.onChange(index, previousHeight, height);
    };

    observeRowElements() {
        return () => {};
    }
}

export function useNotebookFeedLayout(
    entries: FeedLayoutEntry[],
    scrollTarget: FeedScrollTarget | null | undefined,
) {
    const listContainerRef = React.useRef<HTMLDivElement>(null);
    const listRef = useListRef(null);
    const [heightsVersion, setHeightsVersion] = React.useState(0);
    const pendingScrollAdjustmentRef = React.useRef(0);
    const rowHeightsRef = React.useRef<FeedRowHeightCache | null>(null);
    if (rowHeightsRef.current == null) {
        rowHeightsRef.current = new FeedRowHeightCache(entries, (index, previousHeight, height) => {
            const list = listRef.current?.element;
            const cache = rowHeightsRef.current;
            if (list != null && cache != null) {
                const anchoredScrollTop = list.scrollTop + pendingScrollAdjustmentRef.current;
                if (cache.getRowOffset(index) + previousHeight <= anchoredScrollTop) {
                    pendingScrollAdjustmentRef.current += height - previousHeight;
                }
            }
            setHeightsVersion(version => version + 1);
        });
    }
    rowHeightsRef.current.updateEntries(entries);
    const rowHeightCache = rowHeightsRef.current;
    const rowHeights = React.useMemo(() => ({
        getAverageRowHeight: () => rowHeightCache.getAverageRowHeight(),
        getRowHeight: (index: number) => rowHeightCache.getRowHeight(index),
        setRowHeight: rowHeightCache.setRowHeight,
        observeRowElements: () => () => {},
    }), [rowHeightCache, heightsVersion]);
    React.useLayoutEffect(() => {
        const adjustment = pendingScrollAdjustmentRef.current;
        pendingScrollAdjustmentRef.current = 0;
        const list = listRef.current?.element;
        if (list != null && adjustment !== 0) list.scrollTop += adjustment;
    }, [heightsVersion, listRef]);
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

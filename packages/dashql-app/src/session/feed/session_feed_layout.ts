import * as React from 'react';

import { useListRef } from 'react-window';

import { observeSize } from '../../ui/foundations/size_observer.js';
import { useScrollbarWidth } from '../../utils/scrollbar.js';

interface FeedLayoutEntry {
    scriptId: number;
    estimatedHeight: number;
}

const SEPARATOR_HEIGHT = 40;
const FIRST_SEPARATOR_HEIGHT = 48;

export class FeedRowHeightCache {
    private readonly measuredHeights = new Map<number, number>();
    /// The mean amount that the measured scripts exceed their estimates by.
    /// The estimate only counts the editor lines, the results of a script make its card taller.
    /// react-window sizes the list by extrapolating the rows it has laid out, the measured rows around the viewport.
    /// With the unmeasured rows at their bare estimate, the list grows far taller than its rows,
    /// and a scroll into that excess shows an empty feed.
    private estimateCorrection = 0;

    constructor(
        private entries: FeedLayoutEntry[],
        private readonly onChange: (index: number, previousHeight: number, height: number) => void = () => {},
        private firstSeparatorHeight = FIRST_SEPARATOR_HEIGHT,
    ) {}

    updateEntries(entries: FeedLayoutEntry[], firstSeparatorHeight = this.firstSeparatorHeight) {
        if (entries !== this.entries) {
            this.entries = entries;
            this.updateEstimateCorrection();
        }
        this.firstSeparatorHeight = firstSeparatorHeight;
    }

    private updateEstimateCorrection() {
        let excess = 0;
        let measured = 0;
        for (const entry of this.entries) {
            const height = this.measuredHeights.get(entry.scriptId);
            if (height == null) continue;
            excess += height - entry.estimatedHeight;
            ++measured;
        }
        this.estimateCorrection = measured === 0 ? 0 : excess / measured;
    }

    private getEntryHeight(entry: FeedLayoutEntry) {
        return this.measuredHeights.get(entry.scriptId)
            ?? Math.max(SEPARATOR_HEIGHT, Math.round(entry.estimatedHeight + this.estimateCorrection));
    }

    getAverageRowHeight() {
        if (this.entries.length === 0) return SEPARATOR_HEIGHT;
        const totalEntryHeight = this.entries.reduce((total, entry) => total + this.getEntryHeight(entry), 0);
        const totalSeparatorHeight = this.firstSeparatorHeight + this.entries.length * SEPARATOR_HEIGHT;
        return (totalEntryHeight + totalSeparatorHeight) / (this.entries.length * 2 + 1);
    }

    getRowHeight(index: number) {
        if (index % 2 === 0) {
            return index === 0 ? this.firstSeparatorHeight : SEPARATOR_HEIGHT;
        }
        const entry = this.entries[Math.floor(index / 2)];
        return entry == null ? undefined : this.getEntryHeight(entry);
    }

    /// The offset of a row from the top of the list, the sum of the rows above it
    getRowOffset(index: number) {
        let offset = 0;
        for (let i = 0; i < index; ++i) {
            offset += this.getRowHeight(i) ?? this.getAverageRowHeight();
        }
        return offset;
    }

    setRowHeight = (index: number, height: number) => {
        const entry = index % 2 === 1 ? this.entries[Math.floor(index / 2)] : null;
        if (entry == null) return;
        if (this.measuredHeights.get(entry.scriptId) === height) return;
        const previousHeight = this.getEntryHeight(entry);
        this.measuredHeights.set(entry.scriptId, height);
        this.updateEstimateCorrection();
        this.onChange(index, previousHeight, height);
    };

    observeRowElements() {
        return () => {};
    }
}

/// The space kept around a revealed script
const REVEAL_MARGIN = 16;

/// The scroll offset that brings a span of the list into view, null if it is in view already.
/// A span taller than the viewport shows its start, the agent's script reads from the top.
export function revealScrollOffset(spanTop: number, spanBottom: number, scrollTop: number, viewportHeight: number): number | null {
    const top = Math.max(0, spanTop - REVEAL_MARGIN);
    const bottom = spanBottom + REVEAL_MARGIN;
    if (top >= scrollTop && bottom <= scrollTop + viewportHeight) return null;
    const target = bottom - top > viewportHeight || top < scrollTop ? top : bottom - viewportHeight;
    return Math.abs(target - scrollTop) < 1 ? null : target;
}

export function useSessionFeedLayout(entries: FeedLayoutEntry[], firstSeparatorHeight = FIRST_SEPARATOR_HEIGHT) {
    const listContainerRef = React.useRef<HTMLDivElement>(null);
    const listRef = useListRef(null);
    const [heightsVersion, setHeightsVersion] = React.useState(0);
    const rowHeightsRef = React.useRef<FeedRowHeightCache | null>(null);
    if (rowHeightsRef.current == null) {
        rowHeightsRef.current = new FeedRowHeightCache(entries, () => {
            setHeightsVersion(version => version + 1);
        }, firstSeparatorHeight);
    }
    rowHeightsRef.current.updateEntries(entries, firstSeparatorHeight);
    const rowHeightCache = rowHeightsRef.current;
    const rowHeights = React.useMemo(() => ({
        getAverageRowHeight: () => rowHeightCache.getAverageRowHeight(),
        getRowHeight: (index: number) => rowHeightCache.getRowHeight(index),
        setRowHeight: rowHeightCache.setRowHeight,
        observeRowElements: () => () => {},
    }), [rowHeightCache, heightsVersion, firstSeparatorHeight]);
    const getRowOffset = React.useCallback((index: number) => rowHeightCache.getRowOffset(index), [rowHeightCache]);
    const listContainerSize = observeSize(listContainerRef);
    const listWidth = listContainerSize?.width ?? 0;
    const listHeight = listContainerSize?.height ?? 0;
    const listScrollbarInset = useScrollbarWidth();

    return {
        listContainerRef,
        listRef,
        rowHeights,
        rowHeightsVersion: heightsVersion,
        getRowOffset,
        listWidth,
        listHeight,
        listScrollbarInset,
    };
}

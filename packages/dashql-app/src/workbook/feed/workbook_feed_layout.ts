import * as React from 'react';

import { useListRef } from 'react-window';

import { useObservedSize } from '@akohn/dashql-react/components/size_observer';
import { useScrollbarWidth } from '@akohn/dashql-react/dom/scrollbar';

interface FeedLayoutEntry {
    scriptId: number;
    estimatedHeight: number;
}

/// The space above the first script without a head of the feed
export const FEED_TOP_PADDING = 32;
/// The space between the label of a section and its content, the gap of `StageSection`
export const FEED_LABEL_GAP = 12;
/// The space above the first script. The head of the feed ends with the label of the scripts, the first script stands
/// below it like the content of a section below its label.
export function feedTopSpace(topInset: number): number {
    return topInset > 0 ? topInset + FEED_LABEL_GAP : FEED_TOP_PADDING;
}
/// The space between two scripts, the add buttons of the scripts sit in it
export const FEED_GAP = 32;
/// The space below the last script, it holds the add button below the last script
export const FEED_END_PADDING = 32;
/// The height of a script that is not measured yet, at least its header
const MIN_ENTRY_HEIGHT = 40;

/// The heights of the rows of the feed, one row per script.
/// A row is the card of the script and the space that follows it, the first row also holds the space above the feed
/// and the inputs of the workbook in it.
/// The rows measure the cards only, the spaces are added here.
export class FeedRowHeightCache {
    private readonly measuredHeights = new Map<number, number>();
    /// The mean amount that the measured scripts exceed their estimates by.
    /// The estimate only counts the editor lines, the results of a script make its card taller.
    /// react-window sizes the list by extrapolating the rows it has laid out, the measured rows around the viewport.
    /// With the unmeasured rows at their bare estimate, the list grows far taller than its rows,
    /// and a scroll into that excess shows an empty feed.
    private estimateCorrection = 0;
    /// The height of the prompt that floats over the bottom of the feed, the last script scrolls clear of it
    private bottomInset = 0;
    /// The height of the inputs of the workbook above the first script, they scroll with the scripts
    private topInset = 0;

    constructor(
        private entries: FeedLayoutEntry[],
        /// Called after a height changed, with how far the row at the top of the viewport moved
        private readonly onChange: (scrollShift: number) => void = () => {},
        private readonly getScrollOffset: () => number = () => 0,
    ) {}

    updateEntries(entries: FeedLayoutEntry[]) {
        if (entries !== this.entries) {
            this.entries = entries;
            this.updateEstimateCorrection();
        }
    }

    /// Set the height of the prompt over the bottom of the feed, returns whether it changed
    setBottomInset(inset: number): boolean {
        if (inset === this.bottomInset) return false;
        this.bottomInset = inset;
        return true;
    }

    /// Set the height of the inputs above the first script, returns whether it changed
    setTopInset(inset: number): boolean {
        if (inset === this.topInset) return false;
        this.topInset = inset;
        return true;
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
            ?? Math.max(MIN_ENTRY_HEIGHT, Math.round(entry.estimatedHeight + this.estimateCorrection));
    }

    /// The space of a row above its card
    private getLeadingSpace(index: number) {
        return index === 0 ? feedTopSpace(this.topInset) : 0;
    }

    /// The space of a row below its card
    private getTrailingSpace(index: number) {
        return index === this.entries.length - 1 ? FEED_END_PADDING + this.bottomInset : FEED_GAP;
    }

    getAverageRowHeight() {
        if (this.entries.length === 0) return MIN_ENTRY_HEIGHT;
        let total = feedTopSpace(this.topInset) + FEED_END_PADDING + this.bottomInset + (this.entries.length - 1) * FEED_GAP;
        for (const entry of this.entries) total += this.getEntryHeight(entry);
        return total / this.entries.length;
    }

    getRowHeight(index: number) {
        const entry = this.entries[index];
        if (entry == null) return undefined;
        return this.getLeadingSpace(index) + this.getEntryHeight(entry) + this.getTrailingSpace(index);
    }

    /// The offset of a row from the top of the list, the sum of the rows above it
    getRowOffset(index: number) {
        let offset = 0;
        for (let i = 0; i < index; ++i) {
            offset += this.getRowHeight(i) ?? this.getAverageRowHeight();
        }
        return offset;
    }

    /// The top and the bottom of the card of a script in the list, without the spaces around it
    getEntrySpan(index: number): [number, number] {
        const top = this.getRowOffset(index) + this.getLeadingSpace(index);
        const entry = this.entries[index];
        return [top, top + (entry != null ? this.getEntryHeight(entry) : 0)];
    }

    /// The index of the row at a scroll offset
    private getRowAtOffset(scrollOffset: number) {
        let bottom = 0;
        for (let i = 0; i < this.entries.length; ++i) {
            bottom += this.getRowHeight(i) ?? 0;
            if (bottom > scrollOffset) return i;
        }
        return Math.max(0, this.entries.length - 1);
    }

    /// Store the measured height of the card of a row.
    /// Measuring a row also changes the estimates of the unmeasured rows, the shift covers all rows above the viewport.
    setRowHeight = (index: number, height: number) => {
        const entry = this.entries[index];
        if (entry == null) return;
        if (this.measuredHeights.get(entry.scriptId) === height) return;
        const anchor = this.getRowAtOffset(this.getScrollOffset());
        const anchorOffset = this.getRowOffset(anchor);
        this.measuredHeights.set(entry.scriptId, height);
        this.updateEstimateCorrection();
        this.onChange(this.getRowOffset(anchor) - anchorOffset);
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

/// The layout of the feed. `bottomInset` is the height of the prompt that floats over the bottom of the feed, `topInset`
/// the height of the inputs above the first script.
export function useWorkbookFeedLayout(entries: FeedLayoutEntry[], bottomInset = 0, topInset = 0) {
    const listContainerRef = React.useRef<HTMLDivElement>(null);
    const listRef = useListRef(null);
    const [heightsVersion, setHeightsVersion] = React.useState(0);
    const rowHeightsRef = React.useRef<FeedRowHeightCache | null>(null);
    const pendingScrollShift = React.useRef(0);
    if (rowHeightsRef.current == null) {
        rowHeightsRef.current = new FeedRowHeightCache(entries, scrollShift => {
            pendingScrollShift.current += scrollShift;
            setHeightsVersion(version => version + 1);
        }, () => listRef.current?.element?.scrollTop ?? 0);
    }
    rowHeightsRef.current.updateEntries(entries);
    rowHeightsRef.current.setBottomInset(bottomInset);
    rowHeightsRef.current.setTopInset(topInset);
    const rowHeightCache = rowHeightsRef.current;
    const rowHeights = React.useMemo(() => ({
        getAverageRowHeight: () => rowHeightCache.getAverageRowHeight(),
        getRowHeight: (index: number) => rowHeightCache.getRowHeight(index),
        setRowHeight: rowHeightCache.setRowHeight,
        observeRowElements: () => () => {},
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the cache is mutable, a new object after a measure or a new inset makes the list read its heights again
    }), [rowHeightCache, heightsVersion, bottomInset, topInset]);
    // A row above the viewport changed its height: the rows in view stay in place.
    // The browser can't anchor the scroll position itself, the list positions its rows with transforms.
    React.useLayoutEffect(() => {
        const scrollShift = pendingScrollShift.current;
        pendingScrollShift.current = 0;
        const element = listRef.current?.element;
        if (scrollShift !== 0 && element != null) element.scrollTop += scrollShift;
    }, [heightsVersion, listRef]);
    // The inputs changed their height: the scripts in view stay in place, unless the inputs are in view themselves
    const shownTopInset = React.useRef(topInset);
    React.useLayoutEffect(() => {
        const shift = topInset - shownTopInset.current;
        const element = listRef.current?.element;
        if (shift !== 0 && element != null && element.scrollTop > shownTopInset.current) element.scrollTop += shift;
        shownTopInset.current = topInset;
    }, [topInset, listRef]);
    const getEntrySpan = React.useCallback((index: number) => rowHeightCache.getEntrySpan(index), [rowHeightCache]);
    const listContainerSize = useObservedSize(listContainerRef);
    const listWidth = listContainerSize?.width ?? 0;
    const listHeight = listContainerSize?.height ?? 0;
    const listScrollbarInset = useScrollbarWidth();
    // The space that the scrollbar takes from the list, none for an overlay scrollbar
    const [listScrollbarGutter, setListScrollbarGutter] = React.useState(0);
    React.useLayoutEffect(() => {
        const element = listRef.current?.element;
        if (element != null) setListScrollbarGutter(element.offsetWidth - element.clientWidth);
    }, [listWidth, listRef]);

    return {
        listContainerRef,
        listRef,
        rowHeights,
        rowHeightsVersion: heightsVersion,
        getEntrySpan,
        listWidth,
        listHeight,
        listScrollbarInset,
        listScrollbarGutter,
    };
}

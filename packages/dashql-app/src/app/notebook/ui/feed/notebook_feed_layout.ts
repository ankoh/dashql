import * as React from 'react';

import { useListRef } from 'react-window';

import { observeSize } from '../../../../ui/foundations/size_observer.js';
import { useScrollbarWidth } from '../../../../utils/scrollbar.js';

const HEIGHT_CHANGE_EPSILON = 0.5;
const FEED_TOP_PADDING = 24;
const FEED_MOBILE_TOP_PADDING = 8;
const FEED_BOTTOM_FADE_HEIGHT = 24;

export interface FeedScrollTarget {
    fileName: string;
    version: number;
}

export interface ScriptPreviewHint {
    height?: number;
    formattedText?: string;
}

interface FeedLayoutEntry {
    fileName: string;
    scriptId: number;
}

export function useNotebookFeedLayout(
    entries: FeedLayoutEntry[],
    scrollTarget: FeedScrollTarget | null | undefined,
    pendingScrollToBottomRef: React.MutableRefObject<boolean>,
) {
    const listContainerRef = React.useRef<HTMLDivElement>(null);
    const listRef = useListRef(null);
    const composeSectionRef = React.useRef<HTMLDivElement>(null);

    const previewHintsRef = React.useRef<Map<number, ScriptPreviewHint>>(new Map());
    const [heightsVersion, setHeightsVersion] = React.useState(0);
    const onHeightMeasured = React.useCallback((scriptId: number, height: number) => {
        const previous = previewHintsRef.current.get(scriptId);
        if (previous?.height != null && Math.abs(previous.height - height) < HEIGHT_CHANGE_EPSILON) return;
        previewHintsRef.current.set(scriptId, { ...previous, height });
        setHeightsVersion(version => version + 1);
    }, []);
    const onFormattedText = React.useCallback((scriptId: number, scriptText: string) => {
        const previous = previewHintsRef.current.get(scriptId);
        previewHintsRef.current.set(scriptId, { ...previous, formattedText: scriptText });
    }, []);

    const listContainerSize = observeSize(listContainerRef);
    const listWidth = listContainerSize?.width ?? 0;
    const listHeight = listContainerSize?.height ?? 0;
    const listScrollbarInset = useScrollbarWidth();
    const topPadding = listWidth > 0 && listWidth <= 700 ? FEED_MOBILE_TOP_PADDING : FEED_TOP_PADDING;

    const composeSectionSize = observeSize(composeSectionRef);
    const fillerRowHeight = (composeSectionSize?.height ?? 0) + 24 + FEED_BOTTOM_FADE_HEIGHT;

    React.useEffect(() => {
        if (!pendingScrollToBottomRef.current || !listRef.current) return;
        pendingScrollToBottomRef.current = false;
        listRef.current.scrollToRow({ index: entries.length, align: 'end' });
    }, [entries.length, listRef, pendingScrollToBottomRef]);

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
        listRef.current.scrollToRow({ index: targetIndex, align: 'start' });
    }, [listRef, scrollTarget]);

    return {
        listContainerRef,
        listRef,
        composeSectionRef,
        previewHints: previewHintsRef.current,
        heightsVersion,
        onHeightMeasured,
        onFormattedText,
        listWidth,
        listHeight,
        listScrollbarInset,
        topPadding,
        fillerRowHeight,
    };
}

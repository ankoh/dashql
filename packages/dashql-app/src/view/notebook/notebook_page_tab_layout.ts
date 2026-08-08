export interface NotebookPageTabPlacement {
    left: number;
    width: number;
    zIndex: number;
    side: 'left' | 'selected' | 'right';
}

export interface ScriptFolderTabLayout {
    stacked: boolean;
    placements: NotebookPageTabPlacement[];
}

const DOT_SLOT_WIDTH = 18;
const MIN_SELECTED_WIDTH = 24;

/// Compute a view-only page-card layout. A fitting row uses natural widths; overflow keeps the
/// selected card fully visible and compresses the cards on either side into overlapping stacks.
export function layoutNotebookPageTabs(
    viewportWidth: number,
    naturalWidths: number[],
    selectedIndex: number,
): ScriptFolderTabLayout {
    if (naturalWidths.length === 0) return { stacked: false, placements: [] };

    const widths = naturalWidths.map(width => Math.max(1, width));
    const selected = Math.min(Math.max(selectedIndex, 0), widths.length - 1);
    const naturalTotal = widths.reduce((sum, width) => sum + width, 0);
    const availableWidth = Math.max(0, viewportWidth);

    if (naturalTotal <= availableWidth) {
        let left = 0;
        const placements = widths.map((width, index) => {
            const placement: NotebookPageTabPlacement = {
                left,
                width,
                zIndex: index === selected ? 2 : 1,
                side: index < selected ? 'left' : index > selected ? 'right' : 'selected',
            };
            left += width;
            return placement;
        });
        return { stacked: false, placements };
    }

    const dotCount = widths.length - 1;
    const desiredWidth = widths[selected] + dotCount * DOT_SLOT_WIDTH;
    const dotWidth = desiredWidth <= availableWidth
        ? DOT_SLOT_WIDTH
        : Math.min(DOT_SLOT_WIDTH, Math.max(0, availableWidth - Math.min(MIN_SELECTED_WIDTH, availableWidth)) / dotCount);
    const selectedWidth = Math.min(widths[selected], Math.max(0, availableWidth - dotCount * dotWidth));
    let left = Math.max(0, (availableWidth - selectedWidth - dotCount * dotWidth) / 2);
    const placements = widths.map((_width, index): NotebookPageTabPlacement => {
        const isSelected = index === selected;
        const width = isSelected ? selectedWidth : dotWidth;
        const placement = {
            left,
            width,
            zIndex: isSelected ? 2 : 1,
            side: index < selected ? 'left' as const : index > selected ? 'right' as const : 'selected' as const,
        };
        left += width;
        return placement;
    });

    return { stacked: true, placements };
}

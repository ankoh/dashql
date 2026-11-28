import * as React from 'react';
import * as styles from './workbook_views_page.module.css';

import { ButtonSize, ButtonVariant, IconButton } from '@akohn/dashql-react/components/button';
import { SegmentedControl, SegmentedControlSize } from '@akohn/dashql-react/components/segmented_control';
import { SymbolIcon } from '@akohn/dashql-react/components/symbol_icon';
import { classNames } from '@akohn/dashql-react/dom/classnames';
import { WorkbookViewMode, isDefaultViewMode } from '../workbook_view_mode.js';

const PreviousViewIcon = SymbolIcon('chevron_left_12');
const NextViewIcon = SymbolIcon('chevron_right_12');
// The bookmark of the view that the workbook opens in, octicons
const DefaultViewIcon = SymbolIcon('bookmark_16');
const DefaultViewSetIcon = SymbolIcon('bookmark_filled_16');
// The views of the switch, octicons
const FeedViewIcon = SymbolIcon('rows_16');
const DashboardViewIcon = SymbolIcon('dashboard_16');
const DataflowViewIcon = SymbolIcon('workflow_16');

/// The views of the switch in its order, the feed first
export const WORKBOOK_VIEWS: [WorkbookViewMode, string, typeof FeedViewIcon][] = [
    [WorkbookViewMode.Feed, 'Feed', FeedViewIcon],
    [WorkbookViewMode.Dashboard, 'Dashboard', DashboardViewIcon],
    [WorkbookViewMode.Dataflow, 'Dataflow', DataflowViewIcon],
];

/// The elements that move with the arrow keys themselves: text, editors, composite widgets, dialogs and the handle of a
/// card that the keyboard drags (dnd-kit presses the handle of the dragged item, its keyboard sensor listens on the
/// document after the page). Elsewhere the arrow keys switch the views of the workbook.
const ARROW_KEY_TARGETS = [
    'input', 'textarea', 'select', '[contenteditable]:not([contenteditable="false"])',
    '[role="grid"]', '[role="treegrid"]', '[role="listbox"]', '[role="menu"]', '[role="menubar"]', '[role="radiogroup"]',
    '[role="slider"]', '[role="tablist"]', '[role="tree"]', '[role="dialog"]',
    '[aria-roledescription][aria-pressed="true"]',
].join(', ');

function usesArrowKeys(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest(ARROW_KEY_TARGETS) != null;
}

interface Props {
    /// The view that shows
    activeView: WorkbookViewMode;
    /// Show another view
    onShowView: (view: WorkbookViewMode) => void;
    /// The view that the workbook opens in
    defaultView: WorkbookViewMode;
    /// Make a view the one that the workbook opens in. Without it, e.g. in the greeter, there is no bookmark.
    onSetDefaultView?: (view: WorkbookViewMode) => void;
    /// Do the arrow keys of the page step through the views? Not while the page is hidden.
    arrowKeys: boolean;
}

/// The switch of the views of a workbook in the bar: the bookmark of the default view, the arrows that step through
/// the views like the arrow keys, and the views
export function WorkbookViewSwitch(props: Props): React.ReactElement {
    const { activeView, onShowView, defaultView, onSetDefaultView } = props;
    const viewIndex = WORKBOOK_VIEWS.findIndex(([view]) => view === activeView);
    const stepView = React.useCallback((step: number) => {
        const next = WORKBOOK_VIEWS[viewIndex + step];
        if (next != null) onShowView(next[0]);
    }, [viewIndex, onShowView]);
    React.useEffect(() => {
        if (!props.arrowKeys) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
            const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
            if (step === 0 || usesArrowKeys(event.target)) return;
            event.preventDefault();
            stepView(step);
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [props.arrowKeys, stepView]);

    // The bookmark marks the view that the workbook opens in, also for the people it is shared with. Marking the
    // bookmarked view again returns the workbook to the feed. A view that a workbook doesn't open in has no bookmark.
    const activeViewIsDefault = activeView === defaultView;
    const activeLabel = (WORKBOOK_VIEWS[viewIndex]?.[1] ?? 'Feed').toLowerCase();
    const bookmarkable = isDefaultViewMode(activeView);
    const toggleDefaultView = React.useCallback(() => {
        const next = activeViewIsDefault ? WorkbookViewMode.Feed : activeView;
        if (next !== defaultView) onSetDefaultView?.(next);
    }, [activeView, activeViewIsDefault, defaultView, onSetDefaultView]);
    const defaultViewDescription = !bookmarkable
        ? `A workbook doesn't open in the ${activeLabel}, it opens in the feed`
        : !activeViewIsDefault
            ? `Open the workbook in the ${activeLabel}`
            : activeView === WorkbookViewMode.Feed
                ? 'The workbook opens in the feed'
                : `The workbook opens in the ${activeLabel}, click to open it in the feed`;
    return (
        <>
            {onSetDefaultView != null && (
                <IconButton size={ButtonSize.Small} variant={ButtonVariant.Invisible}
                    className={classNames(styles.view_default, activeViewIsDefault && styles.view_default_set)}
                    aria-label="Default view" aria-pressed={activeViewIsDefault} description={defaultViewDescription}
                    disabled={!bookmarkable} data-testid="workbook-view-default" onClick={toggleDefaultView}>
                    {activeViewIsDefault ? <DefaultViewSetIcon size={14} /> : <DefaultViewIcon size={14} />}
                </IconButton>
            )}
            {/* The arrows beside the switch tell that the arrow keys step through the views */}
            <IconButton size={ButtonSize.Small} variant={ButtonVariant.Invisible} className={styles.view_step}
                aria-label="Previous view" description="Previous view (←)" data-testid="workbook-view-previous"
                disabled={viewIndex <= 0} onClick={() => stepView(-1)}>
                <PreviousViewIcon size={12} />
            </IconButton>
            <SegmentedControl
                aria-label="Workbook view"
                data-testid="workbook-view-switch"
                size={SegmentedControlSize.Small}
                onChange={(selectedIndex) => onShowView(WORKBOOK_VIEWS[selectedIndex]?.[0] ?? WorkbookViewMode.Feed)}
            >
                {WORKBOOK_VIEWS.map(([view, label, Icon]) => (
                    <SegmentedControl.IconButton
                        key={view}
                        className={styles.view_switch_button}
                        aria-label={label}
                        icon={<Icon size={14} />}
                        selected={activeView === view}
                    />
                ))}
            </SegmentedControl>
            <IconButton size={ButtonSize.Small} variant={ButtonVariant.Invisible} className={styles.view_step}
                aria-label="Next view" description="Next view (→)" data-testid="workbook-view-next"
                disabled={viewIndex >= WORKBOOK_VIEWS.length - 1} onClick={() => stepView(1)}>
                <NextViewIcon size={12} />
            </IconButton>
        </>
    );
}

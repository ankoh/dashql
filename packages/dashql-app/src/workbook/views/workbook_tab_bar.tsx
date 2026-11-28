import * as React from 'react';
import * as styles from './workbook_tab_bar.module.css';

import { classNames } from '@akohn/dashql-react/dom/classnames';
import { Wobble, WobbleMode } from '../../agent/wobble.js';
import { WorkbookViewMode } from '../workbook_view_mode.js';
import { WORKBOOK_VIEWS } from './workbook_view_switch.js';

/// The run of the workbook as the face in the middle of the bar shows it
export type WorkbookTabBarRun = 'idle' | 'running' | 'succeeded' | 'failed';

interface Props {
    /// The view that shows
    activeView: WorkbookViewMode;
    onShowView: (view: WorkbookViewMode) => void;
    /// Is the composer open over the view?
    promptExpanded: boolean;
    /// Open or close the composer, without it the face only tells the run
    onTogglePrompt?: (expanded: boolean) => void;
    run: WorkbookTabBarRun;
}

/// The views of a workbook as tabs at the bottom of a compact window, with Wobble in their middle: the face tells the
/// run of the workbook and opens the composer over the view (docs/design/narrow_layouts.md). Wider windows switch the
/// views in the bar at the top and show Wobble in its bar.
export function WorkbookTabBar(props: Props): React.ReactElement {
    const { activeView, onShowView, onTogglePrompt, promptExpanded } = props;
    const tab = ([view, label, Icon]: (typeof WORKBOOK_VIEWS)[number]) => (
        <button
            key={view}
            type="button"
            role="tab"
            aria-selected={view === activeView}
            className={classNames(styles.tab, view === activeView && styles.tab_active)}
            data-testid="workbook-tab"
            data-view={view}
            onClick={() => onShowView(view)}
        >
            <Icon size={16} />
            <span className={styles.label}>{label === 'Dashboard' ? 'Board' : label === 'Dataflow' ? 'Flow' : label}</span>
        </button>
    );
    return (
        <nav className={styles.tab_bar} aria-label="Workbook views" data-testid="workbook-tab-bar" data-workbook-tab-bar>
            <div className={styles.tabs} role="tablist" aria-label="Views">{WORKBOOK_VIEWS.slice(0, 2).map(tab)}</div>
            <button
                type="button"
                className={classNames(styles.wobble, promptExpanded && styles.wobble_open)}
                aria-label={promptExpanded ? 'Close the prompt' : 'Open the prompt'}
                aria-expanded={promptExpanded}
                data-testid="workbook-tab-wobble"
                data-run={props.run}
                disabled={onTogglePrompt == null}
                onClick={() => onTogglePrompt?.(!promptExpanded)}
            >
                <Wobble className={styles.face} aria-hidden="true" mode={WobbleMode.Face} />
                {props.run !== 'idle' && <span className={styles.run_dot} aria-hidden="true" />}
            </button>
            <div className={styles.tabs} role="tablist" aria-label="More views">{WORKBOOK_VIEWS.slice(2).map(tab)}</div>
        </nav>
    );
}

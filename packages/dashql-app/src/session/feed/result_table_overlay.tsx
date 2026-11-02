import * as React from 'react';
import * as styles from './result_table_overlay.module.css';

import type { QueryExecutionState } from '../../query/query_execution_state.js';
import { ButtonSize, ButtonVariant, IconButton } from '../../ui/foundations/button.js';
import { useFocusTrap } from '../../ui/foundations/focus.js';
import { Overlay, OverlaySize } from '../../ui/foundations/overlay.js';
import { ScreenFullIcon, ScreenNormalIcon, SymbolIcon } from '../../ui/foundations/symbol_icon.js';
import { QueryResultDetails } from '../../views/query_result/query_result_details.js';
import { TableColumnHeader } from '../../views/query_result/data_table_cell.js';

export interface ResultTableOverlayDependencies {
    QueryResultDetails: typeof QueryResultDetails;
}

const DEFAULT_DEPENDENCIES: ResultTableOverlayDependencies = {
    QueryResultDetails,
};

interface Props {
    scriptName: string;
    query: QueryExecutionState;
    onClose: () => void;
    dependencies?: ResultTableOverlayDependencies;
}

/// The height of the card before it is enlarged, the table grows up to it and scrolls then
const MAX_CARD_HEIGHT = 600;
const HEADER_HEIGHT = 44;
// The table opens popups of its own (search, cell details), a click into them must not close the card
const IGNORE_OUTSIDE_CLICK = () => {};
const CloseIcon = SymbolIcon('x_16');

/// The full result table of a feed entry in a card over the feed: the table with its column plots under
/// a header with the name of the script, a button to enlarge the card to the window and a close button.
export function ResultTableOverlay(props: Props): React.ReactElement {
    const dependencies = props.dependencies ?? DEFAULT_DEPENDENCIES;
    const dialogRef = React.useRef<HTMLElement | null>(null);
    const [expanded, setExpanded] = React.useState(false);

    // Focus the dialog, not its first button
    useFocusTrap({
        containerRef: dialogRef as React.RefObject<HTMLElement>,
        initialFocusRef: dialogRef as React.RefObject<HTMLElement>,
        restoreFocusOnCleanUp: true,
    });

    return (
        <Overlay
            centered
            width={OverlaySize.XXL}
            height={OverlaySize.AUTO}
            maxHeight={OverlaySize.XL}
            preventFocusOnOpen
            expanded={expanded}
            onEscape={props.onClose}
            onClickOutside={IGNORE_OUTSIDE_CLICK}
        >
            <section
                ref={dialogRef}
                className={styles.dialog}
                role="dialog"
                aria-modal="true"
                tabIndex={-1}
                aria-label={`Query results of ${props.scriptName}`}
                data-expanded={expanded || undefined}
                data-testid="result-table-overlay"
            >
                <header className={styles.header}>
                    <h2 className={styles.title}>{props.scriptName}</h2>
                    <div className={styles.spacer} />
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        size={ButtonSize.Small}
                        aria-label={expanded ? 'Restore size' : 'Enlarge'}
                        aria-pressed={expanded}
                        data-testid="result-table-overlay-resize"
                        onClick={() => setExpanded(e => !e)}
                    >
                        {expanded ? <ScreenNormalIcon size={16} /> : <ScreenFullIcon size={16} />}
                    </IconButton>
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        size={ButtonSize.Small}
                        aria-label="Close query results"
                        data-testid="result-table-overlay-close"
                        onClick={props.onClose}
                    >
                        <CloseIcon size={16} />
                    </IconButton>
                </header>
                <div className={styles.body}>
                    <dependencies.QueryResultDetails
                        query={props.query}
                        debugMode={false}
                        // The enlarged card fills the window, the table fills the card
                        fitHeight={!expanded}
                        maxHeight={expanded ? undefined : MAX_CARD_HEIGHT - HEADER_HEIGHT}
                        columnHeader={TableColumnHeader.WithColumnPlots}
                    />
                </div>
            </section>
        </Overlay>
    );
}

import * as React from 'react';

import type { QueryExecutionState } from '../connections/query_execution_state.js';
import { ButtonSize, ButtonVariant, IconButton } from '../../../ui/foundations/button.js';
import { useFocusTrap } from '../../../ui/foundations/focus.js';
import { Overlay, OverlaySize } from '../../../ui/foundations/overlay.js';
import { SymbolIcon } from '../../../ui/foundations/symbol_icon.js';
import { QueryResultDetails } from '../compute/ui/query_result/query_result_details.js';
import { TableColumnHeader } from '../compute/ui/query_result/data_table_cell.js';
import * as styles from './shell_query_result_overlay.module.css';

interface Props {
    query: QueryExecutionState;
    onClose: () => void;
}

const MAX_OVERLAY_HEIGHT = 600;

export const ShellQueryResultOverlay: React.FC<Props> = ({ query, onClose }) => {
    const closeRef = React.useRef<HTMLButtonElement>(null);
    const dialogRef = React.useRef<HTMLElement>(null);
    const CloseIcon = SymbolIcon('x_16');
    useFocusTrap({
        containerRef: dialogRef as React.RefObject<HTMLElement>,
        initialFocusRef: closeRef as React.RefObject<HTMLElement>,
        restoreFocusOnCleanUp: true,
    });
    return (
        <Overlay
            centered
            width={OverlaySize.XXL}
            height={OverlaySize.AUTO}
            maxHeight={OverlaySize.XL}
            initialFocusRef={closeRef}
            onEscape={onClose}
            onClickOutside={onClose}
        >
            <section ref={dialogRef} className={styles.card} role="dialog" aria-modal="true" aria-label="Shell query results">
                <QueryResultDetails
                    query={query}
                    debugMode={false}
                    fitHeight
                    maxHeight={MAX_OVERLAY_HEIGHT}
                    columnHeader={TableColumnHeader.WithColumnPlots}
                    actions={(
                        <IconButton
                            ref={closeRef}
                            variant={ButtonVariant.Invisible}
                            size={ButtonSize.Small}
                            aria-label="Close shell query results"
                            onClick={onClose}
                        >
                            <CloseIcon size={16} />
                        </IconButton>
                    )}
                />
            </section>
        </Overlay>
    );
};

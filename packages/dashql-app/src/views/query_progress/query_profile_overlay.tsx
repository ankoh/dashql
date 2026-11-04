import * as React from 'react';
import * as styles from './query_profile_overlay.module.css';

import { ButtonSize, ButtonVariant, IconButton } from '../../ui/foundations/button.js';
import { useFocusTrap } from '../../ui/foundations/focus.js';
import { Overlay, OverlaySize } from '../../ui/foundations/overlay.js';
import { ScreenFullIcon, ScreenNormalIcon, SymbolIcon } from '../../ui/foundations/symbol_icon.js';

const CloseIcon = SymbolIcon('x_16');
// The plan has popups of its own (operator details), a click into them must not close the card
const IGNORE_OUTSIDE_CLICK = () => {};

interface Props {
    /// The plan viewer, it fills the card
    children: React.ReactNode;
    onClose: () => void;
}

/// The plan of a query in a large card over the page
export function QueryProfileOverlay(props: Props): React.ReactElement {
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
            height={OverlaySize.XL}
            preventFocusOnOpen
            onEscape={props.onClose}
            onClickOutside={IGNORE_OUTSIDE_CLICK}
            expanded={expanded}
        >
            <section
                ref={dialogRef}
                className={styles.dialog}
                role="dialog"
                aria-modal="true"
                tabIndex={-1}
                aria-label="Query plan"
                data-testid="query-profile-overlay"
            >
                <header className={styles.header}>
                    <h2 className={styles.title}>Query plan</h2>
                    <div className={styles.spacer} />
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        size={ButtonSize.Small}
                        aria-label={expanded ? 'Restore size' : 'Expand'}
                        aria-pressed={expanded}
                        data-testid="query-profile-overlay-expand"
                        onClick={() => setExpanded(e => !e)}
                    >
                        {expanded ? <ScreenNormalIcon size={16} /> : <ScreenFullIcon size={16} />}
                    </IconButton>
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        size={ButtonSize.Small}
                        aria-label="Close query plan"
                        data-testid="query-profile-overlay-close"
                        onClick={props.onClose}
                    >
                        <CloseIcon size={16} />
                    </IconButton>
                </header>
                <div className={styles.body}>
                    {props.children}
                </div>
            </section>
        </Overlay>
    );
}

import * as React from 'react';
import symbols from '@ankoh/dashql-svg-symbols';

import { AnchorAlignment, AnchorSide } from '../view/foundations/anchored_position.js';
import { AnchoredOverlay } from '../view/foundations/anchored_overlay.js';
import { OverlaySize } from '../view/foundations/overlay.js';
import { LogViewer } from '../view/internals/log_viewer.js';
import * as styles from './shell_navbar.module.css';

export const ShellInternals: React.FC = () => {
    const [isOpen, setIsOpen] = React.useState(false);
    const close = React.useCallback(() => setIsOpen(false), []);

    return (
        <AnchoredOverlay
            open={isOpen}
            onOpen={() => setIsOpen(true)}
            onClose={close}
            side={AnchorSide.OutsideBottom}
            align={AnchorAlignment.End}
            anchorOffset={16}
            overlayProps={{
                width: OverlaySize.XL,
                height: OverlaySize.L,
            }}
            renderAnchor={(props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
                <button
                    {...props}
                    type="button"
                    className={styles.actionButton}
                >
                    <svg width="14px" height="14px" aria-hidden="true">
                        <use xlinkHref={`${symbols}#processor`} />
                    </svg>
                    <span className={styles.actionLabel}>Internals</span>
                </button>
            )}
        >
            <LogViewer onClose={close} />
        </AnchoredOverlay>
    );
};

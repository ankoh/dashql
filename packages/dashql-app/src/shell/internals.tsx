import * as React from 'react';
import symbols from '@ankoh/dashql-svg-symbols';

import { AnchorAlignment, AnchorSide } from '../shared/ui/foundations/anchored_position.js';
import { LogsOverlay } from '../shared/ui/logs_overlay.js';
import * as styles from './shell_navbar.module.css';

export const ShellInternals: React.FC = () => {
    const [isOpen, setIsOpen] = React.useState(false);
    const close = React.useCallback(() => setIsOpen(false), []);

    return (
        <LogsOverlay
            isOpen={isOpen}
            onOpen={() => setIsOpen(true)}
            onClose={close}
            side={AnchorSide.OutsideBottom}
            align={AnchorAlignment.End}
            anchorOffset={16}
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
        />
    );
};

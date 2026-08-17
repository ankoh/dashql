import * as React from 'react';

import { AnchorAlignment, AnchorSide } from '../ui/foundations/anchored_position.js';
import { DASHQL_VERSION } from '../globals.js';
import { AnchoredOverlay } from '../ui/foundations/anchored_overlay.js';
import { ButtonVariant, IconButton } from '../ui/foundations/button.js';
import { ShellInternals } from './internals.js';
import type { ShellQueryExecutionTracker } from './query_execution.js';

import { XIcon } from '@primer/octicons-react';
import symbols from '@ankoh/dashql-svg-symbols';
import * as styles from './shell_navbar.module.css';

interface VersionButtonProps {
    engineVersion: string | null;
}

const VersionButton: React.FC<VersionButtonProps> = (props: VersionButtonProps) => {
    const [isOpen, setIsOpen] = React.useState(false);

    return (
        <AnchoredOverlay
            open={isOpen}
            onOpen={() => setIsOpen(true)}
            onClose={() => setIsOpen(false)}
            side={AnchorSide.OutsideBottom}
            align={AnchorAlignment.End}
            anchorOffset={16}
            renderAnchor={(anchorProps: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
                <button
                    {...anchorProps}
                    type="button"
                    className={styles.actionButton}
                    aria-label={props.engineVersion == null ? 'Hyper version' : `Hyper version ${props.engineVersion}`}
                >
                    <svg className={styles.actionIcon} width="16px" height="16px" aria-hidden="true">
                        <use xlinkHref={`${symbols}#package`} />
                    </svg>
                    <span className={styles.actionLabel}>{props.engineVersion ?? 'Hyper'}</span>
                </button>
            )}
        >
            <div className={styles.versionOverlay}>
                <div className={styles.versionHeader}>
                    <div className={styles.versionTitle}>Version</div>
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        aria-label="Close"
                        onClick={() => setIsOpen(false)}
                    >
                        <XIcon />
                    </IconButton>
                </div>
                <div className={styles.versionInfo}>
                    <div>Hyper Version</div>
                    <div>{props.engineVersion ?? 'Loading...'}</div>
                    <div>Shell Version</div>
                    <div>{DASHQL_VERSION}</div>
                </div>
            </div>
        </AnchoredOverlay>
    );
};

interface ShellNavBarProps {
    engineVersion: string | null;
    queryExecutions: ShellQueryExecutionTracker;
}

export const ShellNavBar: React.FC<ShellNavBarProps> = (props: ShellNavBarProps) => (
    <header className={styles.navbar}>
        <div className={styles.brand}>
            <svg className={styles.brand_logo} width="100%" height="100%">
                <use xlinkHref={`${symbols}#hyper_banner`} />
            </svg>
        </div>
        <nav className={styles.actions} aria-label="Shell utilities">
            <ShellInternals queryExecutions={props.queryExecutions} />
            <VersionButton engineVersion={props.engineVersion} />
        </nav>
    </header>
);

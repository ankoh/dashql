import * as React from 'react';

import { AnchorAlignment, AnchorSide } from '../shared/ui/foundations/anchored_position.js';
import { DASHQL_VERSION } from '../shared/globals.js';
import { useVersionCheck } from '../shared/platform/version/version_check.js';
import { VersionCheckIndicator, VersionInfoOverlay } from '../shared/ui/version/version_viewer.js';
import { ShellInternals } from './internals.js';

import symbols from '@ankoh/dashql-svg-symbols';
import * as styles from './shell_navbar.module.css';

const VersionButton: React.FC = () => {
    const [isOpen, setIsOpen] = React.useState(false);
    const versionCheck = useVersionCheck();

    return (
        <VersionInfoOverlay
            isOpen={isOpen}
            onOpen={() => setIsOpen(true)}
            onClose={() => setIsOpen(false)}
            side={AnchorSide.OutsideBottom}
            align={AnchorAlignment.End}
            anchorOffset={16}
            renderAnchor={(props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
                <button
                    {...props}
                    type="button"
                    className={styles.actionButton}
                >
                    <VersionCheckIndicator status={versionCheck} />
                    <span className={styles.actionLabel}>{DASHQL_VERSION}</span>
                </button>
            )}
        />
    );
};

export const ShellNavBar: React.FC = () => (
    <header className={styles.navbar}>
        <div className={styles.brand}>
            <svg className={styles.brand_logo} width="100%" height="100%">
                <use xlinkHref={`${symbols}#hyper_banner`} />
            </svg>
        </div>
        <nav className={styles.actions} aria-label="Shell utilities">
            <ShellInternals />
            <VersionButton />
        </nav>
    </header>
);

import * as React from 'react';

import { AnchorAlignment, AnchorSide } from '../ui/foundations/anchored_position.js';
import { DASHQL_VERSION, HYPERDB_WASM_VERSION } from '../globals.js';
import { AnchoredOverlay } from '../ui/foundations/anchored_overlay.js';
import { ButtonVariant, IconButton } from '../ui/foundations/button.js';
import { FlavorLogo, useRequestedAppFlavor } from '../app/flavor/flavor_provider.js';
import { Tag, TagVariant } from '../ui/foundations/tag.js';
import { ShellInternals } from './internals.js';

import { XIcon } from '../ui/foundations/symbol_icon.js';
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
                    aria-label={`HyperDB WASM version ${HYPERDB_WASM_VERSION}`}
                >
                    <svg className={styles.actionIcon} width="16px" height="16px" aria-hidden="true">
                        <use xlinkHref={`${symbols}#package`} />
                    </svg>
                    <span className={styles.actionLabel}>{HYPERDB_WASM_VERSION}</span>
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
                    <div className={styles.versionLabel}>
                        <svg width="16px" height="16px" aria-hidden="true">
                            <use xlinkHref={`${symbols}#hyper_outlines`} />
                        </svg>
                        <span>hyperdb</span>
                    </div>
                    <div>{props.engineVersion ?? 'Loading...'}</div>
                    <a
                        className={styles.versionLinkButton}
                        href="https://www.npmjs.com/package/hyperdb-wasm"
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Open hyperdb-wasm on npm"
                    >
                        <svg width="16px" height="16px" aria-hidden="true">
                            <use xlinkHref={`${symbols}#npmjs`} />
                        </svg>
                        <span>hyperdb-wasm</span>
                    </a>
                    <div>{HYPERDB_WASM_VERSION}</div>
                    <a
                        className={styles.versionLinkButton}
                        href="https://github.com/ankoh/dashql"
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Open DashQL on GitHub"
                    >
                        <svg width="16px" height="16px" aria-hidden="true">
                            <use xlinkHref={`${symbols}#github`} />
                        </svg>
                        <span>dashql</span>
                    </a>
                    <div>{DASHQL_VERSION}</div>
                </div>
            </div>
        </AnchoredOverlay>
    );
};

/// The height of a wordmark in the navbar
const WORDMARK_HEIGHT = 16;

/// The brand of the shell.
/// The shell is branded for Hyper, a flavor requested by the url replaces the Hyper banner with its logo and tagline.
const ShellBrand: React.FC = () => {
    const flavor = useRequestedAppFlavor();
    if (flavor == null) {
        return (
            <svg className={styles.brand_logo} width="100%" height="100%" aria-hidden="true">
                <use xlinkHref={`${symbols}#hyper_banner`} />
            </svg>
        );
    }
    return (
        <span className={styles.brand_mark} data-testid="shell-flavor-brand">
            {flavor.logo.wordmark
                ? <FlavorLogo height={WORDMARK_HEIGHT} ariaHidden />
                : <>
                    <FlavorLogo height={24} ariaHidden />
                    <span>{flavor.displayName}</span>
                </>}
            {flavor.tagline != null && (
                <Tag variant={TagVariant.Outline} className={styles.brand_tagline}>{flavor.tagline}</Tag>
            )}
        </span>
    );
};

interface ShellNavBarProps {
    engineVersion: string | null;
    onReset: () => void;
    Internals?: React.ComponentType;
}

export const ShellNavBar: React.FC<ShellNavBarProps> = (props: ShellNavBarProps) => {
    const Internals = props.Internals ?? ShellInternals;
    return (
        <header className={styles.navbar}>
            <button
                type="button"
                className={styles.brand}
                aria-label="Reset shell"
                data-testid="shell-reset"
                onClick={props.onReset}
            >
                <ShellBrand />
            </button>
            <nav className={styles.actions} aria-label="Shell utilities">
                <Internals />
                <VersionButton engineVersion={props.engineVersion} />
            </nav>
        </header>
    );
};

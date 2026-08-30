import * as React from 'react';
import * as styles from './navbar.module.css';
import symbols from '@ankoh/dashql-svg-symbols';

import { XIcon } from '../../ui/foundations/symbol_icon.js';

import { AnchorAlignment, AnchorSide } from '../../ui/foundations/anchored_position.js';
import { HoverMode, NavBarButton, NavBarButtonWithRef } from './navbar_button.js';
import { InternalsViewerOverlay } from './internals/internals_overlay.js';
import { NotebookStorageOverlay } from '../notebook/persistence/ui/notebook_storage_overlay.js';
import { PlatformType, usePlatformType } from '../../platform/platform_type.js';
import { DASHQL_VERSION } from '../../globals.js';
import { VersionCheckIndicator } from '../../ui/version/version_viewer.js';
import { VersionInfoOverlay } from '../../ui/version/version_viewer.js';
import { exportNotebookAsUrl, NotebookLinkTarget } from '../notebook/persistence/notebook_export.js';
import { getConnectionParamsFromStateDetails } from '../notebook/connections/connection_params.js';
import { useConnectionState } from '../notebook/connections/connection_registry.js';
import { useStorageReader } from '../notebook/persistence/storage_provider.js';
import { displayPath } from '../notebook/persistence/notebook_locator.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { RouteContext, useRouteContext, useRouterNavigate, CHANGE_NOTEBOOK } from '../router/router.js';
import { useVersionCheck } from '../../platform/version/version_check.js';
import { useNotebookScripts } from '../notebook/scripts/notebook_scripts_registry.js';
import { Link, useLocation } from 'react-router-dom';
import { NotebookViewMode, useNotebookViewMode } from '../notebook/scripts/notebook_commands.js';

const LOG_CTX = "navbar";

const InternalsButton = (props: { notebookId: string | null }) => {
    const [showInternalsViewerOverlay, setInternalsViewerOverlay] = React.useState<boolean>(false);

    return (
        <div className={styles.tab}>
            <InternalsViewerOverlay
                notebookId={props.notebookId}
                isOpen={showInternalsViewerOverlay}
                onClose={() => setInternalsViewerOverlay(false)}
                renderAnchor={(p: object) => (
                    <NavBarButtonWithRef
                        {...p}
                        className={styles.tab_button} hover={HoverMode.Darken} onClick={() => setInternalsViewerOverlay(true)}
                    >
                        <>
                            <svg width="14px" height="14px">
                                <use xlinkHref={`${symbols}#processor`} />
                            </svg>
                            <span className={styles.tab_button_text}>Internals</span>
                        </>
                    </NavBarButtonWithRef>
                )}
                side={AnchorSide.OutsideBottom}
                align={AnchorAlignment.End}
                anchorOffset={16}
            />
        </div>
    );
};

/// The clickable notebook path bar. Forwards a ref + anchor props so it can anchor the overlay
/// while keeping the bar's flex layout (ellipsized path).
const NotebookBarButton = React.forwardRef<HTMLButtonElement, {
    notebookName: string | null;
    notebookPath: string;
    onClick?: (event: React.MouseEvent) => void;
} & object>((props, ref) => {
    const { notebookName, notebookPath, ...anchorProps } = props;
    // When the user has named the notebook, the name leads (crisp, primary) and the path follows
    // dimmed — the name is what a human recognises, the path stays visible as the address. With no
    // name, the path is the sole, primary label (unchanged from before).
    const hasName = notebookName != null && notebookName.length > 0;
    return (
        <button
            ref={ref}
            type="button"
            className={styles.notebook_bar_button}
            title={hasName ? `${notebookName} · ${notebookPath}` : notebookPath}
            {...anchorProps}
        >
            {hasName && (
                <div className={styles.notebook_bar_name}>
                    {notebookName}
                </div>
            )}
            <div className={hasName ? styles.notebook_bar_path_secondary : styles.notebook_bar_path}>
                {notebookPath}
            </div>
        </button>
    );
});

const NotebookBar = (props: {
    notebookId: string | null;
    notebookName: string | null;
    notebookPath: string;
    openInAppUrl?: string | null;
    route: RouteContext;
    onClose: () => void;
}) => {
    const [showStorageOverlay, setShowStorageOverlay] = React.useState<boolean>(false);

    return (
        <div className={styles.notebook_bar_container}>
            <div className={styles.notebook_bar}>
                <NotebookStorageOverlay
                    notebookId={props.notebookId}
                    isOpen={showStorageOverlay}
                    onClose={() => setShowStorageOverlay(false)}
                    renderAnchor={(p: object) => (
                        <NotebookBarButton
                            {...p}
                            notebookName={props.notebookName}
                            notebookPath={props.notebookPath}
                            onClick={() => setShowStorageOverlay(true)}
                        />
                    )}
                    side={AnchorSide.OutsideBottom}
                    align={AnchorAlignment.Start}
                    anchorOffset={8}
                />
                {props.openInAppUrl !== undefined && (
                    <Link
                        aria-label="Open notebook in desktop app"
                        className={styles.notebook_bar_action}
                        to={props.openInAppUrl ?? ""}
                        state={props.route}
                        title="Open notebook in desktop app"
                    >
                        <svg width="14px" height="14px" aria-hidden="true">
                            <use xlinkHref={`${symbols}#download_desktop`} />
                        </svg>
                    </Link>
                )}
                <button
                    type="button"
                    className={styles.notebook_bar_action}
                    title="Close Notebook"
                    aria-label="Close Notebook"
                    onClick={props.onClose}
                >
                    <XIcon />
                </button>
            </div>
        </div>
    );
};

const NotebookShellButton = () => {
    const { mode, setMode } = useNotebookViewMode();
    const shellActive = mode === NotebookViewMode.Shell;
    const label = shellActive ? 'Return to notebook' : 'Open shell';
    return (
        <div className={`${styles.tab} ${shellActive ? styles.active : ''}`}>
            <NavBarButton
                className={styles.tab_button}
                hover={HoverMode.Darken}
                onClick={() => setMode(shellActive ? NotebookViewMode.Notebook : NotebookViewMode.Shell)}
            >
                <>
                    <svg width="16px" height="16px" aria-hidden="true">
                        <use xlinkHref={`${symbols}#shell_24`} />
                    </svg>
                    <span className={styles.tab_button_text}>Shell</span>
                </>
            </NavBarButton>
        </div>
    );
};

const VersionButton = (_props: {}) => {
    const [showVersionOverlay, setShowVersionOverlay] = React.useState<boolean>(false);
    const versionCheck = useVersionCheck();

    return (
        <div className={styles.tab}>
            <VersionInfoOverlay
                isOpen={showVersionOverlay}
                onClose={() => setShowVersionOverlay(false)}
                renderAnchor={(p: object) => (
                    <NavBarButtonWithRef
                        {...p}
                        className={styles.tab_button} hover={HoverMode.Darken} onClick={() => setShowVersionOverlay(true)}
                    >
                        <>
                            <VersionCheckIndicator status={versionCheck} />
                            <span className={styles.tab_button_text}>{DASHQL_VERSION}</span>
                        </>
                    </NavBarButtonWithRef>
                )}
                side={AnchorSide.OutsideBottom}
                align={AnchorAlignment.End}
                anchorOffset={16}
            />
        </div>
    );
};

const BrandLogo = (props: { onClose: () => void }) => (
    <div className={styles.brand_logo} data-electron-drag-region aria-label="dashql" onClick={props.onClose}>
        <svg width="24px" height="24px" aria-hidden="true">
            <use xlinkHref={`${symbols}#dashql`} />
        </svg>
    </div>
);

const BrandIdentity = () => (
    <div className={styles.brand_identity} data-electron-drag-region>
        <svg width="24px" height="24px" aria-hidden="true">
            <use xlinkHref={`${symbols}#dashql`} />
        </svg>
        <span>DashQL</span>
    </div>
);

export const CompactNavBar = (): React.ReactElement => {
    const route = useRouteContext();
    const platform = usePlatformType();
    const navbarClass = platform === PlatformType.MACOS ? styles.navbar_mac : styles.navbar_default;

    return (
        <header className={`${navbarClass} ${styles.navbar_overlay}`} data-electron-drag-region>
            <BrandIdentity />
            <div className={styles.navbar_actions}>
                <InternalsButton notebookId={route.notebookId} />
                <VersionButton />
            </div>
        </header>
    );
};

export const NavBar = (): React.ReactElement => {
    const logger = useLogger();
    const route = useRouteContext();
    const navigate = useRouterNavigate();
    const platform = usePlatformType();
    const location = useLocation();
    const storageReader = useStorageReader();

    const [notebookScripts] = useNotebookScripts(route.notebookId ?? null);
    const [connection, _modifyConnection] = useConnectionState(route.notebookId ?? notebookScripts?.notebookId ?? null);

    const handleCloseNotebook = React.useCallback(() => {
        navigate({
            type: CHANGE_NOTEBOOK,
            value: null,
        });
    }, [navigate]);

    const isBrowser = platform === PlatformType.WEB;
    const isMac = platform === PlatformType.MACOS;
    const setupLinkTarget = isBrowser ? NotebookLinkTarget.NATIVE : NotebookLinkTarget.WEB;

    const [setupUrl, setSetupUrl] = React.useState<URL | null>(null);
    React.useEffect(() => {
        let cancelled = false;

        async function generateUrl() {
            if (connection == null || notebookScripts == null || !connection.details) {
                setSetupUrl(null);
                return;
            }

            const connParams = getConnectionParamsFromStateDetails(connection.details);
            if (!connParams) {
                setSetupUrl(null);
                return;
            }

            const url = await exportNotebookAsUrl(storageReader.backend, notebookScripts.notebookId, connParams, setupLinkTarget);
            if (!cancelled) {
                setSetupUrl(url);
            }
        }

        generateUrl();

        return () => {
            cancelled = true;
        };
    }, [notebookScripts, connection, setupLinkTarget, storageReader.backend]);

    React.useEffect(() => {
        logger.debug("Navigated to path", { "path": location.pathname }, LOG_CTX);
    }, [location.pathname]);

    const notebookId = connection?.notebookId ?? null;
    // The notebook bar shows a display path (opfs://… or fs://…) reconstructed from the uuid +
    // its recorded physical location; the uuid stays the authoritative identity.
    const notebookPath = notebookId ? displayPath(notebookId, storageReader.getNotebookLocation(notebookId)) : "";
    return (
        // Electron excludes the interactive controls below via the global no-drag rules.
        <div className={isMac ? styles.navbar_mac : styles.navbar_default}
            data-electron-drag-region
        >
            {isBrowser && <BrandLogo onClose={handleCloseNotebook} />}
            <div className={styles.tabs}>
                <NotebookBar
                    notebookId={notebookId}
                    notebookName={connection?.name ?? null}
                    notebookPath={notebookPath}
                    openInAppUrl={isBrowser ? setupUrl?.toString() ?? null : undefined}
                    route={route}
                    onClose={handleCloseNotebook}
                />
            </div>
            <div className={styles.navbar_actions}>
                {notebookId != null && <NotebookShellButton />}
                <InternalsButton notebookId={notebookId} />
                <VersionButton />
            </div>
        </div>
    );
};

export function NavBarContainer(props: { children: React.ReactElement }) {
    return (
        <div className={styles.container}>
            <NavBar key={0} />
            <div key={1} className={styles.page_container}>
                {props.children}
            </div>
        </div>
    );
}

import * as React from 'react';
import * as styles from './navbar.module.css';
import symbols from '@ankoh/dashql-svg-symbols';

import { XIcon } from '@primer/octicons-react';

import { AnchorAlignment, AnchorSide } from './foundations/anchored_position.js';
import { HoverMode, NavBarButtonWithRef, NavBarLink } from './navbar_button.js';
import { InternalsViewerOverlay } from './internals/internals_overlay.js';
import { NotebookStorageOverlay } from './storage/notebook_storage_overlay.js';
import { PlatformType, usePlatformType } from '../platform/platform_type.js';
import { DASHQL_VERSION } from '../globals.js';
import { VersionCheckIndicator } from './version_viewer.js';
import { VersionInfoOverlay } from './version_viewer.js';
import { exportNotebookAsUrl, NotebookLinkTarget } from '../platform/storage/notebook_export.js';
import { getConnectionParamsFromStateDetails } from '../connection/connection_params.js';
import { useConnectionState } from '../connection/connection_registry.js';
import { useStorageReader } from '../platform/storage/storage_provider.js';
import { displayPath } from '../platform/storage/notebook_locator.js';
import { useLogger } from '../platform/logger/logger_provider.js';
import { RouteContext, useRouteContext, useRouterNavigate, CHANGE_NOTEBOOK } from '../router.js';
import { useVersionCheck } from '../platform/version/version_check.js';
import { useNotebookScripts } from '../scripts/notebook_scripts_registry.js';
import { useLocation } from 'react-router-dom';

const LOG_CTX = "navbar";

const OpenIn = (props: { url?: string | null; alt?: string; icon?: string; label: string, newWindow?: boolean, state: RouteContext }) => (
    <div className={styles.tab}>
        <NavBarLink
            className={styles.tab_button}
            to={props.url ?? ""}
            hover={HoverMode.Darken}
            newWindow={props.newWindow}
            state={props.state}
        >
            <>
                {props.icon &&
                    <svg width="16px" height="16px">
                        <use xlinkHref={props.icon} />
                    </svg>
                }
                <span className={styles.tab_button_text}>{props.label}</span>
            </>
        </NavBarLink>
    </div>
);

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

const NotebookBar = (props: { notebookId: string | null; notebookName: string | null; notebookPath: string; onClose: () => void }) => {
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
                <button
                    type="button"
                    className={styles.notebook_bar_close}
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
    <div className={styles.brand_logo} data-tauri-drag-region="true" aria-label="dashql" onClick={props.onClose}>
        <svg width="24px" height="24px" aria-hidden="true">
            <use xlinkHref={`${symbols}#dashql`} />
        </svg>
    </div>
);

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
        // `deep` makes the whole toolbar a native window-drag surface: clicks anywhere drag the
        // window except on genuinely interactive elements (the notebook bar button, version buttons,
        // …), which Tauri's drag.js still treats as clickable and lets through. A bare/`true` value
        // would only drag on direct clicks on this exact element — which the notebook bar button now
        // fully covers, so dragging would never trigger.
        <div className={isMac ? styles.navbar_mac : styles.navbar_default}
            data-tauri-drag-region="deep"
        >
            {isBrowser && <BrandLogo onClose={handleCloseNotebook} />}
            <div className={styles.tabs}>
                <NotebookBar notebookId={notebookId} notebookName={connection?.name ?? null} notebookPath={notebookPath} onClose={handleCloseNotebook} />
            </div>
            <div className={styles.version_container}>
                <InternalsButton notebookId={notebookId} />
                <VersionButton />
                {isBrowser &&
                    <OpenIn label="Open in App" url={setupUrl?.toString()} icon={`${symbols}#download_desktop`} newWindow={false} state={route} />
                }
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

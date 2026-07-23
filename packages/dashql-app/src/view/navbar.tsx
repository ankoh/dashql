import * as React from 'react';
import * as styles from './navbar.module.css';
import symbols from '@ankoh/dashql-svg-symbols';

import { XIcon } from '@primer/octicons-react';

import { AnchorAlignment, AnchorSide } from './foundations/anchored_position.js';
import { HoverMode, NavBarButtonWithRef, NavBarLink } from './navbar_button.js';
import { InternalsViewerOverlay } from './internals/internals_overlay.js';
import { SessionStorageOverlay } from './storage/session_storage_overlay.js';
import { PlatformType, usePlatformType } from '../platform/platform_type.js';
import { DASHQL_VERSION } from '../globals.js';
import { VersionCheckIndicator } from './version_viewer.js';
import { VersionInfoOverlay } from './version_viewer.js';
import { encodeNotebookAsZipUrl, NotebookLinkTarget } from '../notebook/notebook_export.js';
import { getConnectionParamsFromStateDetails } from '../connection/connection_params.js';
import { useConnectionState } from '../connection/connection_registry.js';
import { useStorageReader } from '../platform/storage/storage_provider.js';
import { displayPath } from '../platform/storage/session_locator.js';
import { useLogger } from '../platform/logger/logger_provider.js';
import { RouteContext, useRouteContext, useRouterNavigate, CHANGE_SESSION } from '../router.js';
import { useVersionCheck } from '../platform/version/version_check.js';
import { useNotebookState } from '../notebook/notebook_state_registry.js';
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

const InternalsButton = (_props: {}) => {
    const [showInternalsViewerOverlay, setInternalsViewerOverlay] = React.useState<boolean>(false);

    return (
        <div className={styles.tab}>
            <InternalsViewerOverlay
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

/// The clickable session path bar. Forwards a ref + anchor props so it can anchor the overlay
/// while keeping the bar's flex layout (ellipsized path).
const SessionBarButton = React.forwardRef<HTMLButtonElement, {
    sessionName: string | null;
    sessionPath: string;
    onClick?: (event: React.MouseEvent) => void;
} & object>((props, ref) => {
    const { sessionName, sessionPath, ...anchorProps } = props;
    // When the user has named the session, the name leads (crisp, primary) and the path follows
    // dimmed — the name is what a human recognises, the path stays visible as the address. With no
    // name, the path is the sole, primary label (unchanged from before).
    const hasName = sessionName != null && sessionName.length > 0;
    return (
        <button
            ref={ref}
            type="button"
            className={styles.session_bar_button}
            title={hasName ? `${sessionName} · ${sessionPath}` : sessionPath}
            {...anchorProps}
        >
            {hasName && (
                <div className={styles.session_bar_name}>
                    {sessionName}
                </div>
            )}
            <div className={hasName ? styles.session_bar_path_secondary : styles.session_bar_path}>
                {sessionPath}
            </div>
        </button>
    );
});

const SessionBar = (props: { sessionId: string | null; sessionName: string | null; sessionPath: string; onClose: () => void }) => {
    const [showStorageOverlay, setShowStorageOverlay] = React.useState<boolean>(false);

    return (
        <div className={styles.session_bar_container}>
            <div className={styles.session_bar}>
                <SessionStorageOverlay
                    sessionId={props.sessionId}
                    isOpen={showStorageOverlay}
                    onClose={() => setShowStorageOverlay(false)}
                    renderAnchor={(p: object) => (
                        <SessionBarButton
                            {...p}
                            sessionName={props.sessionName}
                            sessionPath={props.sessionPath}
                            onClick={() => setShowStorageOverlay(true)}
                        />
                    )}
                    side={AnchorSide.OutsideBottom}
                    align={AnchorAlignment.Start}
                    anchorOffset={8}
                />
                <button
                    type="button"
                    className={styles.session_bar_close}
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

    const [notebook, _modifyNotebook] = useNotebookState(route.sessionId ?? null);
    const [connection, _modifyConnection] = useConnectionState(route.sessionId ?? notebook?.sessionId ?? null);

    const handleCloseNotebook = React.useCallback(() => {
        navigate({
            type: CHANGE_SESSION,
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
            if (connection == null || notebook == null || !connection.details) {
                setSetupUrl(null);
                return;
            }

            const connParams = getConnectionParamsFromStateDetails(connection.details);
            if (!connParams) {
                setSetupUrl(null);
                return;
            }

            const url = await encodeNotebookAsZipUrl(notebook, connParams, setupLinkTarget, connection.name);
            if (!cancelled) {
                setSetupUrl(url);
            }
        }

        generateUrl();

        return () => {
            cancelled = true;
        };
    }, [notebook, connection, setupLinkTarget]);

    React.useEffect(() => {
        logger.debug("Navigated to path", { "path": location.pathname }, LOG_CTX);
    }, [location.pathname]);

    const sessionId = connection?.sessionId ?? null;
    // The session bar shows a display path (opfs://… or fs://…) reconstructed from the uuid +
    // its recorded physical location; the uuid stays the authoritative identity.
    const sessionPath = sessionId ? displayPath(sessionId, storageReader.getSessionLocation(sessionId)) : "";
    return (
        // `deep` makes the whole toolbar a native window-drag surface: clicks anywhere drag the
        // window except on genuinely interactive elements (the session bar button, version buttons,
        // …), which Tauri's drag.js still treats as clickable and lets through. A bare/`true` value
        // would only drag on direct clicks on this exact element — which the session bar button now
        // fully covers, so dragging would never trigger.
        <div className={isMac ? styles.navbar_mac : styles.navbar_default}
            data-tauri-drag-region="deep"
        >
            {isBrowser && <BrandLogo onClose={handleCloseNotebook} />}
            <div className={styles.tabs}>
                <SessionBar sessionId={sessionId} sessionName={connection?.name ?? null} sessionPath={sessionPath} onClose={handleCloseNotebook} />
            </div>
            <div className={styles.version_container}>
                <InternalsButton />
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

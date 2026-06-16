import * as React from 'react';
import * as styles from './navbar.module.css';
import symbols from '@ankoh/dashql-svg-symbols';

import { AnchorAlignment, AnchorSide } from './foundations/anchored_position.js';
import { HoverMode, NavBarButtonWithRef, NavBarLink } from './navbar_button.js';
import { InternalsViewerOverlay } from './internals/internals_overlay.js';
import { PlatformType, usePlatformType } from '../platform/platform_type.js';
import { DASHQL_VERSION } from '../globals.js';
import { VersionCheckIndicator } from './version_viewer.js';
import { VersionInfoOverlay } from './version_viewer.js';
import { encodeNotebookAsZipUrl, NotebookLinkTarget } from '../notebook/notebook_export.js';
import { getConnectionParamsFromStateDetails } from '../connection/connection_params.js';
import { useConnectionState } from '../connection/connection_registry.js';
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

            const url = await encodeNotebookAsZipUrl(notebook, connParams, setupLinkTarget);
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

    const isToolPage = location.pathname === "/tool" || location.pathname.startsWith("/tool/");
    const sessionPath = connection?.sessionId ?? "";
    const pageIcon = isToolPage ? `${symbols}#tool` : `${symbols}#book_24`;
    return (
        <div className={isMac ? styles.navbar_mac : styles.navbar_default}
        >
            {isBrowser && <BrandLogo onClose={handleCloseNotebook} />}
            <div className={styles.tabs}
                data-tauri-drag-region="true"
            >
                <div className={styles.session_bar_container}>
                    <div className={styles.session_bar}>
                        <div className={styles.session_bar_icon}>
                            <svg width="16px" height="16px">
                                <use xlinkHref={pageIcon} />
                            </svg>
                        </div>
                        <div className={styles.session_bar_path} title={sessionPath}>
                            {sessionPath}
                        </div>
                    </div>
                </div>
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

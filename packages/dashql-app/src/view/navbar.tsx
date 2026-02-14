import * as React from 'react';
import * as styles from './navbar.module.css';
import symbols from '../../static/svg/symbols.generated.svg';

import { AnchorAlignment, AnchorSide } from './foundations/anchored_position.js';
import { HoverMode, NavBarButtonWithRef, NavBarLink } from './navbar_button.js';
import { InternalsViewerOverlay } from './internals/internals_overlay.js';
import { PlatformType, usePlatformType } from '../platform/platform_type.js';
import { DASHQL_VERSION } from '../globals.js';
import { VersionCheckIndicator } from './version_viewer.js';
import { VersionInfoOverlay } from './version_viewer.js';
import { classNames } from '../utils/classnames.js';
import { encodeNotebookAsProto, encodeNotebookProtoAsUrl, NotebookLinkTarget } from '../notebook/notebook_export.js';
import { getConnectionParamsFromStateDetails } from '../connection/connection_params.js';
import { useConnectionState } from '../connection/connection_registry.js';
import { useLogger } from '../platform/logger_provider.js';
import { RouteContext, useRouteContext } from '../router.js';
import { useVersionCheck } from '../platform/version_check.js';
import { useNotebookState } from '../notebook/notebook_state_registry.js';
import { useThrottledMemo } from '../utils/throttle.js';

const LOG_CTX = "navbar";

const PageTab = (props: { route: string; alt?: string; location: string; icon: string; label: string | null, state: RouteContext }) => (
    <div
        key={props.route}
        className={classNames(styles.tab, {
            [styles.active]: props.location == props.route || props.location == props.alt,
        })}
    >
        <NavBarLink
            className={styles.tab_button}
            to={props.route}
            hover={HoverMode.Darken}
            state={props.state}
        >
            <>
                <svg width="16px" height="16px">
                    <use xlinkHref={props.icon} />
                </svg>
                {props.label && <span className={styles.tab_button_text}>{props.label}</span>}
            </>
        </NavBarLink>
    </div>
);

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

export const NavBar = (): React.ReactElement => {
    const logger = useLogger();
    const route = useRouteContext();
    const platform = usePlatformType();

    const [notebook, _modifyNotebook] = useNotebookState(route.notebookId ?? null);
    const [connection, _modifyConnection] = useConnectionState(route.connectionId ?? notebook?.connectionId ?? null);

    const isBrowser = platform === PlatformType.WEB;
    const isMac = platform === PlatformType.MACOS;
    const setupLinkTarget = isBrowser ? NotebookLinkTarget.NATIVE : NotebookLinkTarget.WEB;
    const setupUrl = useThrottledMemo(() => {
        if (connection == null || notebook == null) {
            return null;
        }
        if (!connection.details) {
            return null;
        }
        const connProto = getConnectionParamsFromStateDetails(connection.details) ?? undefined;
        const notebookProto = encodeNotebookAsProto(notebook, true, connProto);
        return encodeNotebookProtoAsUrl(notebookProto, setupLinkTarget);
    }, [notebook, connection, setupLinkTarget]);

    React.useEffect(() => {
        logger.info("navigated to path", { "path": location.pathname }, LOG_CTX);
    }, [location.pathname]);

    return (
        <div className={isMac ? styles.navbar_mac : styles.navbar_default}
        >
            <div className={styles.tabs}
                data-tauri-drag-region="true"
            >
                <PageTab label="Notebook" route="/notebook" location={location.pathname} icon={`${symbols}#file`} state={route} />
                <PageTab label="Connection" route="/connection" location={location.pathname} icon={`${symbols}#database`} state={route} />
            </div>
            <div className={styles.version_container}>
                <InternalsButton />
                <VersionButton />
                {isBrowser
                    ? <OpenIn label="Open in App" url={setupUrl?.toString()} icon={`${symbols}#download_desktop`} newWindow={false} state={route} />
                    : <OpenIn label="Open in Browser" url={setupUrl?.toString()} icon={`${symbols}#upload_browser`} newWindow={true} state={route} />
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

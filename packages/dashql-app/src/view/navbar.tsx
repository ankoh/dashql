import * as React from 'react';
import * as styles from './navbar.module.css';
import * as symbols from '../../static/svg/symbols.generated.svg';

import { useLocation } from 'react-router-dom';

import { AnchorAlignment, AnchorSide } from './foundations/anchored_position.js';
import { HoverMode, NavBarButtonWithRef, NavBarLink } from './navbar_button.js';
import { InternalsViewerOverlay } from './internals_overlay.js';
import { PlatformType, usePlatformType } from '../platform/platform_type.js';
import { DASHQL_VERSION } from '../globals.js';
import { VersionCheckIndicator } from './version_viewer.js';
import { VersionInfoOverlay } from './version_viewer.js';
import { classNames } from '../utils/classnames.js';
import { encodeWorkbookAsProto, encodeWorkbookProtoAsUrl, WorkbookLinkTarget } from '../workbook/workbook_export_url.js';
import { getConnectionParamsFromStateDetails } from '../connection/connection_params.js';
import { useConnectionState } from '../connection/connection_registry.js';
import { useCurrentWorkbookState } from '../workbook/current_workbook.js';
import { useLogger } from '../platform/logger_provider.js';
import { useVersionCheck } from '../platform/version_check.js';

const LOG_CTX = "navbar";

const PageTab = (props: { route: string; alt?: string; location: string; icon: string; label: string | null }) => (
    <div
        key={props.route}
        className={classNames(styles.tab, {
            [styles.active]: props.location == props.route || props.location == props.alt,
        })}
    >
        <NavBarLink className={styles.tab_button} to={props.route} hover={HoverMode.Darken}>
            <>
                <svg width="16px" height="16px">
                    <use xlinkHref={props.icon} />
                </svg>
                {props.label && <span className={styles.tab_button_text}>{props.label}</span>}
            </>
        </NavBarLink>
    </div>
);

const OpenIn = (props: { url?: string | null; alt?: string; icon?: string; label: string, newWindow?: boolean }) => (
    <div className={styles.tab}>
        <NavBarLink className={styles.tab_button} to={props.url ?? ""} hover={HoverMode.Darken} newWindow={props.newWindow}>
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
    const location = useLocation();
    const platformType = usePlatformType();
    const [workbook, _modifyWorkbook] = useCurrentWorkbookState();
    const [connectionState, _setConnectionState] = useConnectionState(workbook?.connectionId ?? null);

    const isBrowser = platformType === PlatformType.WEB;
    const isMac = platformType === PlatformType.MACOS;
    const setupLinkTarget = isBrowser ? WorkbookLinkTarget.NATIVE : WorkbookLinkTarget.WEB;
    const setupUrl = React.useMemo(() => {
        if (workbook == null || connectionState == null) {
            return null;
        }
        const params = getConnectionParamsFromStateDetails(connectionState.details);
        if (params == null) {
            return null;
        }
        const proto = encodeWorkbookAsProto(workbook, params);
        return encodeWorkbookProtoAsUrl(proto, setupLinkTarget);
    }, [workbook, connectionState, setupLinkTarget]);

    React.useEffect(() => {
        logger.info("navigated to path", { "path": location.pathname }, LOG_CTX);
    }, [location.pathname]);

    return (
        <div className={isMac ? styles.navbar_mac : styles.navbar_default}
        >
            <div className={styles.tabs}
                data-tauri-drag-region="true"
            >
                <PageTab label="Workbook" route="/" location={location.pathname} icon={`${symbols}#file`} />
                <PageTab label="Connection" route="/connection" location={location.pathname} icon={`${symbols}#database`} />
            </div>
            <div className={styles.version_container}>
                <InternalsButton />
                <VersionButton />
                {isBrowser
                    ? <OpenIn label="Open in App" url={setupUrl?.toString()} icon={`${symbols}#download_desktop`} newWindow={false} />
                    : <OpenIn label="Open in Browser" url={setupUrl?.toString()} icon={`${symbols}#upload_browser`} newWindow={true} />
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

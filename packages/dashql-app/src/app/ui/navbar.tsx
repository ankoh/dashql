import * as React from 'react';
import * as styles from './navbar.module.css';
import symbols from '@ankoh/dashql-svg-symbols';

import { AnchorAlignment, AnchorSide } from '../../ui/foundations/anchored_position.js';
import { HoverMode, NavBarButtonWithRef } from './navbar_button.js';
import { InternalsViewerOverlay } from './internals/internals_overlay.js';
import { AgentViewOverlay } from '../agent/agent_view.js';
import { useAgentBridge } from '../agent/agent_bridge.js';
import { PlatformType, isMacDesktopHost, usePlatformType } from '../../platform/platform_type.js';
import { DASHQL_VERSION } from '../../globals.js';
import { VersionCheckIndicator } from '../../ui/version/version_viewer.js';
import { VersionInfoOverlay } from '../../ui/version/version_viewer.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { useRouteContext } from '../router/router.js';
import { useVersionCheck } from '../../platform/version/version_check.js';
import { useLocation } from 'react-router-dom';
import { FlavorLogo, useAppFlavor } from '../flavor/flavor_provider.js';
import { NavRail, useNavRailWide } from './nav_rail.js';
import { useMacWindowLayout } from './mac_window_layout.js';

const LOG_CTX = "navbar";

interface NavBarItemProps {
    label: string;
    icon: React.ReactNode;
    /// The props of an anchored overlay
    anchor: object;
    onClick: () => void;
    'data-testid'?: string;
}

const NavBarItem = ({ label, icon, anchor, ...props }: NavBarItemProps) => (
    <NavBarButtonWithRef {...anchor} {...props} className={styles.tab_button} hover={HoverMode.Darken}>
        <>
            {icon}
            <span className={styles.tab_button_text}>{label}</span>
        </>
    </NavBarButtonWithRef>
);

/// Overlays open below the bar at the top
const OVERLAY_POSITION = { side: AnchorSide.OutsideBottom, align: AnchorAlignment.End, anchorOffset: 16 };

const InternalsButton = (props: { sessionId: string | null }) => {
    const [showInternalsViewerOverlay, setInternalsViewerOverlay] = React.useState<boolean>(false);

    return (
        <div className={styles.tab}>
            <InternalsViewerOverlay
                sessionId={props.sessionId}
                isOpen={showInternalsViewerOverlay}
                onClose={() => setInternalsViewerOverlay(false)}
                renderAnchor={(p: object) => (
                    <NavBarItem
                        anchor={p}
                        label="Client"
                        icon={(
                            <svg width="14px" height="14px" aria-hidden="true">
                                <use xlinkHref={`${symbols}#device_desktop_24`} />
                            </svg>
                        )}
                        onClick={() => setInternalsViewerOverlay(true)}
                    />
                )}
                {...OVERLAY_POSITION}
            />
        </div>
    );
};

const AgentButton = () => {
    const bridge = useAgentBridge();
    const [showAgentOverlay, setAgentOverlay] = React.useState<boolean>(false);
    if (bridge == null) return null;

    return (
        <div className={styles.tab}>
            <AgentViewOverlay
                isOpen={showAgentOverlay}
                onClose={() => setAgentOverlay(false)}
                renderAnchor={(p: object) => (
                    <NavBarItem
                        anchor={p}
                        label="Agent"
                        icon={(
                            <svg width="14px" height="14px" aria-hidden="true">
                                <use xlinkHref={`${symbols}#sparkles_fill_16`} />
                            </svg>
                        )}
                        onClick={() => setAgentOverlay(true)}
                        data-testid="agent-settings"
                    />
                )}
                {...OVERLAY_POSITION}
            />
        </div>
    );
};

const VersionButton = (props: { iconSize?: number }) => {
    const [showVersionOverlay, setShowVersionOverlay] = React.useState<boolean>(false);
    const versionCheck = useVersionCheck();

    return (
        <div className={styles.tab}>
            <VersionInfoOverlay
                isOpen={showVersionOverlay}
                onClose={() => setShowVersionOverlay(false)}
                renderAnchor={(p: object) => (
                    <NavBarItem
                        anchor={p}
                        label={`Version ${DASHQL_VERSION}`}
                        icon={<VersionCheckIndicator status={versionCheck} size={props.iconSize} />}
                        onClick={() => setShowVersionOverlay(true)}
                    />
                )}
                {...OVERLAY_POSITION}
            />
        </div>
    );
};

/// The height of a wordmark in the navbar, a bit smaller than square logos to match the cap height of text
const WORDMARK_HEIGHT = 16;

const BrandIdentity = () => {
    const flavor = useAppFlavor();
    return (
        <div className={styles.brand_identity} data-electron-drag-region>
            {flavor.logo.wordmark
                ? <FlavorLogo height={WORDMARK_HEIGHT} ariaHidden />
                : <>
                    <FlavorLogo height={24} ariaHidden />
                    <span>{flavor.displayName}</span>
                </>}
        </div>
    );
};

/// The height of a wordmark in the stripe at the top, a bit smaller than in the compact navbar
const TOP_BAR_WORDMARK_HEIGHT = 14;

/// The brand in the stripe at the top, only the logo without the name.
/// A square logo is a bit larger without the traffic lights of macOS next to it.
const TopBarBrand = (props: { mac: boolean }) => {
    const flavor = useAppFlavor();
    return (
        <div className={styles.brand_identity} data-electron-drag-region>
            {flavor.logo.wordmark
                ? <FlavorLogo height={TOP_BAR_WORDMARK_HEIGHT} ariaHidden />
                : <FlavorLogo height={props.mac ? 22 : 24} ariaHidden />}
        </div>
    );
};

export const CompactNavBar = (props: { showInternals?: boolean }): React.ReactElement => {
    const route = useRouteContext();
    const platform = usePlatformType();
    const navbarClass = platform === PlatformType.DESKTOP ? styles.navbar_mac : styles.navbar_default;

    return (
        <header className={`${navbarClass} ${styles.navbar_overlay}`} data-electron-drag-region>
            <BrandIdentity />
            <div className={styles.navbar_actions}>
                {(props.showInternals ?? true) && <InternalsButton sessionId={route.sessionId} />}
                <VersionButton />
            </div>
        </header>
    );
};

/// Stand-ins for the traffic lights of the macOS window when the browser shows the layout of the desktop app on macOS
const TrafficLightPlaceholders = () => (
    <div className={styles.traffic_lights} aria-hidden="true">
        <span className={styles.traffic_light_close} />
        <span className={styles.traffic_light_minimize} />
        <span className={styles.traffic_light_zoom} />
    </div>
);

/// The navbar is a rail of pages left of the page card below a dark stripe that holds the brand on the left and the overlays on the right.
/// On the desktop app on macOS, the brand follows the traffic lights.
/// The Mac Window Layout setting shows them in the browser.
export function NavBarContainer(props: { children: React.ReactElement }) {
    const logger = useLogger();
    const location = useLocation();
    const route = useRouteContext();
    const macHost = isMacDesktopHost();
    const isMac = useMacWindowLayout();
    const [railWide] = useNavRailWide();

    React.useEffect(() => {
        logger.debug("Navigated to path", { "path": location.pathname }, LOG_CTX);
    }, [location.pathname]);

    return (
        <div className={railWide ? `${styles.container} ${styles.container_wide}` : styles.container}>
            <header key={2} className={isMac ? `${styles.top_bar} ${styles.top_bar_mac}` : styles.top_bar} data-electron-drag-region>
                <TopBarBrand mac={isMac} />
                <div className={styles.top_bar_actions}>
                    <AgentButton />
                    <InternalsButton sessionId={route.sessionId} />
                    <VersionButton iconSize={14} />
                </div>
            </header>
            <NavRail key={0} />
            <div key={1} className={styles.page_container}>
                {props.children}
            </div>
            {isMac && !macHost && <TrafficLightPlaceholders />}
        </div>
    );
}

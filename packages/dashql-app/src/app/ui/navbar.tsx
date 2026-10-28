import * as React from 'react';
import * as styles from './navbar.module.css';
import symbols from '@ankoh/dashql-svg-symbols';

import { AnchorAlignment, AnchorSide } from '../../ui/foundations/anchored_position.js';
import { Tag, TagVariant } from '../../ui/foundations/tag.js';
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
import { SessionViewMode, useSessionViewMode } from '../session/ui/session_view_mode.js';
import { FlavorLogo, useAppFlavor } from '../flavor/flavor_provider.js';
import { NavRail, NavRailButton, useOpenWorkbench } from './nav_rail.js';
import { useMacWindowLayout } from './mac_window_layout.js';

const LOG_CTX = "navbar";

/// Where the buttons of the navbar sit: labeled in the compact navbar of the setup pages, or as icons at the bottom of the rail
enum NavBarPlacement {
    Top,
    Rail,
}

interface NavBarItemProps {
    placement: NavBarPlacement;
    label: string;
    icon: React.ReactNode;
    active?: boolean;
    /// The props of an anchored overlay, if the button opens one
    anchor?: object;
    onClick: () => void;
    'aria-label'?: string;
    'aria-pressed'?: boolean;
    'data-testid'?: string;
}

const NavBarItem = ({ placement, label, icon, active, anchor, ...props }: NavBarItemProps) => placement === NavBarPlacement.Rail
    ? <NavRailButton {...anchor} {...props} label={label} active={active}>{icon}</NavRailButton>
    : (
        <NavBarButtonWithRef {...anchor} {...props} className={styles.tab_button} hover={HoverMode.Darken}>
            <>
                {icon}
                <span className={styles.tab_button_text}>{label}</span>
            </>
        </NavBarButtonWithRef>
    );

/// The tab around a button of the top bar, the rail buttons style themselves
const NavBarTab = (props: { placement: NavBarPlacement; active?: boolean; children: React.ReactNode }) => props.placement === NavBarPlacement.Rail
    ? <>{props.children}</>
    : <div className={`${styles.tab} ${props.active ? styles.active : ''}`}>{props.children}</div>;

/// Overlays open below the top bar, and right of the rail
const overlayPosition = (placement: NavBarPlacement) => placement === NavBarPlacement.Rail
    ? { side: AnchorSide.OutsideRight, align: AnchorAlignment.End, anchorOffset: 12 }
    : { side: AnchorSide.OutsideBottom, align: AnchorAlignment.End, anchorOffset: 16 };

const InternalsButton = (props: { sessionId: string | null; placement: NavBarPlacement }) => {
    const [showInternalsViewerOverlay, setInternalsViewerOverlay] = React.useState<boolean>(false);

    return (
        <NavBarTab placement={props.placement}>
            <InternalsViewerOverlay
                sessionId={props.sessionId}
                isOpen={showInternalsViewerOverlay}
                onClose={() => setInternalsViewerOverlay(false)}
                renderAnchor={(p: object) => (
                    <NavBarItem
                        placement={props.placement}
                        anchor={p}
                        label="Internals"
                        icon={(
                            <svg width="14px" height="14px" aria-hidden="true">
                                <use xlinkHref={`${symbols}#processor`} />
                            </svg>
                        )}
                        onClick={() => setInternalsViewerOverlay(true)}
                    />
                )}
                {...overlayPosition(props.placement)}
            />
        </NavBarTab>
    );
};

const AgentButton = (props: { placement: NavBarPlacement }) => {
    const bridge = useAgentBridge();
    const [showAgentOverlay, setAgentOverlay] = React.useState<boolean>(false);
    if (bridge == null) return null;

    return (
        <NavBarTab placement={props.placement}>
            <AgentViewOverlay
                isOpen={showAgentOverlay}
                onClose={() => setAgentOverlay(false)}
                renderAnchor={(p: object) => (
                    <NavBarItem
                        placement={props.placement}
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
                {...overlayPosition(props.placement)}
            />
        </NavBarTab>
    );
};

const SessionShellButton = (props: { placement: NavBarPlacement }) => {
    const { mode, setMode } = useSessionViewMode();
    const shellActive = mode === SessionViewMode.Shell;
    const label = shellActive ? 'Return to session' : 'Open shell';
    return (
        <NavBarTab placement={props.placement} active={shellActive}>
            <NavBarItem
                placement={props.placement}
                label="Shell"
                aria-label={shellActive ? 'Shell, return to session' : label}
                aria-pressed={shellActive}
                active={shellActive}
                icon={(
                    <svg width="16px" height="16px" aria-hidden="true">
                        <use xlinkHref={`${symbols}#command_palette_24`} />
                    </svg>
                )}
                onClick={() => setMode(shellActive ? SessionViewMode.Session : SessionViewMode.Shell)}
            />
        </NavBarTab>
    );
};

const VersionButton = (props: { placement: NavBarPlacement }) => {
    const [showVersionOverlay, setShowVersionOverlay] = React.useState<boolean>(false);
    const versionCheck = useVersionCheck();

    return (
        <NavBarTab placement={props.placement}>
            <VersionInfoOverlay
                isOpen={showVersionOverlay}
                onClose={() => setShowVersionOverlay(false)}
                renderAnchor={(p: object) => (
                    <NavBarItem
                        placement={props.placement}
                        anchor={p}
                        label={DASHQL_VERSION}
                        icon={<VersionCheckIndicator status={versionCheck} />}
                        onClick={() => setShowVersionOverlay(true)}
                    />
                )}
                {...overlayPosition(props.placement)}
            />
        </NavBarTab>
    );
};

/// The buttons at the bottom of the rail that open the overlays
const NavRailActions = () => {
    const route = useRouteContext();
    return (
        <>
            <AgentButton placement={NavBarPlacement.Rail} />
            {route.sessionId != null && <SessionShellButton placement={NavBarPlacement.Rail} />}
            <InternalsButton sessionId={route.sessionId} placement={NavBarPlacement.Rail} />
            <VersionButton placement={NavBarPlacement.Rail} />
        </>
    );
};

/// The height of a wordmark in the navbar, a bit smaller than square logos to match the cap height of text
const WORDMARK_HEIGHT = 16;
/// The width of a wordmark in the rail, the narrowest rail leaves a margin of 6px on both sides
const RAIL_WORDMARK_WIDTH = 36;

/// The brand mark followed by the tagline of the flavor, sharing the baseline
const BrandMark = (props: { children: React.ReactNode }) => {
    const tagline = useAppFlavor().tagline;
    if (tagline == null) {
        return <>{props.children}</>;
    }
    return (
        <span className={styles.brand_mark}>
            {props.children}
            <Tag variant={TagVariant.Outline} className={styles.brand_tagline}>{tagline}</Tag>
        </span>
    );
};

/// The logo at the top of the rail, without the tagline that would not fit
const BrandLogo = () => {
    const flavor = useAppFlavor();
    const openWorkbench = useOpenWorkbench();

    return (
        <button type="button" className={styles.brand_logo} aria-label="Open session workbench" onClick={openWorkbench}>
            {flavor.logo.wordmark
                ? <FlavorLogo width={RAIL_WORDMARK_WIDTH} ariaHidden />
                : <FlavorLogo height={24} ariaHidden />}
        </button>
    );
};

const BrandIdentity = () => {
    const flavor = useAppFlavor();
    return (
        <div className={styles.brand_identity} data-electron-drag-region>
            {flavor.logo.wordmark
                ? <BrandMark><FlavorLogo height={WORDMARK_HEIGHT} ariaHidden /></BrandMark>
                : <>
                    <FlavorLogo height={24} ariaHidden />
                    <BrandMark><span>{flavor.displayName}</span></BrandMark>
                </>}
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
                {(props.showInternals ?? true) && <InternalsButton sessionId={route.sessionId} placement={NavBarPlacement.Top} />}
                <VersionButton placement={NavBarPlacement.Top} />
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

/// The navbar is a rail left of the page card.
/// On the desktop app on macOS, the traffic lights sit at the top of the rail, above the logo, and reach into a notch of the page card.
/// The Mac Window Layout setting shows this layout in the browser.
export function NavBarContainer(props: { children: React.ReactElement }) {
    const logger = useLogger();
    const location = useLocation();
    const macHost = isMacDesktopHost();
    const isMac = useMacWindowLayout();

    React.useEffect(() => {
        logger.debug("Navigated to path", { "path": location.pathname }, LOG_CTX);
    }, [location.pathname]);

    return (
        <div className={isMac ? `${styles.container} ${styles.container_mac}` : styles.container}>
            <NavRail key={0} header={<BrandLogo />} footer={<NavRailActions />} />
            <div key={1} className={styles.page_container}>
                {props.children}
            </div>
            {isMac && !macHost && <TrafficLightPlaceholders />}
        </div>
    );
}

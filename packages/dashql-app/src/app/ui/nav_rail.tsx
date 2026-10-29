import * as React from 'react';
import * as styles from './nav_rail.module.css';
import symbols from '@ankoh/dashql-svg-symbols';

import { useLocation } from 'react-router-dom';
import { Tooltip } from '../../ui/foundations/tooltip.js';
import { SESSION_PATH, SELECT_SESSION, useRouteContext, useRouterNavigate } from '../router/router.js';
import { SessionViewMode, useSessionViewMode } from '../session/ui/session_view_mode.js';
import { classNames } from '../../utils/classnames.js';
import { useAppConfig, useAppReconfigure } from '../config/app_config.js';
import { useAppFlavor } from '../flavor/flavor_provider.js';
import type { AppFlavorRailPage } from '../flavor/flavors.js';

/// Is the pathname a page of the workspace, the sessions and their connections?
export function isWorkspacePath(pathname: string): boolean {
    return pathname === '/' || pathname === '/session' || pathname.startsWith('/sessions/');
}

/// Open the workbench of the current session, leaving the shell
export function useOpenWorkbench(): () => void {
    const route = useRouteContext();
    const navigate = useRouterNavigate();
    const { setMode } = useSessionViewMode();
    return React.useCallback(() => {
        setMode(SessionViewMode.Session);
        navigate(route.sessionId == null
            ? { type: SESSION_PATH, value: null }
            : { type: SELECT_SESSION, value: route.sessionId });
    }, [navigate, route.sessionId, setMode]);
}

/// Open the shell of the current session
function useOpenShell(): (() => void) | null {
    const route = useRouteContext();
    const navigate = useRouterNavigate();
    const { setMode } = useSessionViewMode();
    const sessionId = route.sessionId;
    const openShell = React.useCallback(() => {
        if (sessionId == null) return;
        setMode(SessionViewMode.Shell);
        navigate({ type: SELECT_SESSION, value: sessionId });
    }, [navigate, sessionId, setMode]);
    return sessionId == null ? null : openShell;
}

/// Is the rail wide, showing the labels of its buttons? Persisted in the app settings.
export function useNavRailWide(): [boolean, () => void] {
    const config = useAppConfig();
    const reconfigure = useAppReconfigure();
    const wide = config?.settings?.navRailWide ?? false;
    const toggle = React.useCallback(() => {
        reconfigure(value => value == null ? null : {
            ...value,
            settings: { ...value.settings, navRailWide: !value.settings?.navRailWide },
        });
    }, [reconfigure]);
    return [wide, toggle];
}

type NavRailButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
    label: string;
    active?: boolean;
    /// Show the label next to the icon instead of in a tooltip
    wide: boolean;
    ref?: React.Ref<HTMLButtonElement>;
    children: React.ReactNode;
};

/// An icon button of the rail, labeled by a tooltip or, in the wide rail, by its label
export const NavRailButton = ({ label, active, wide, className, children, ...props }: NavRailButtonProps) => {
    const button = (
        <button
            {...props}
            type="button"
            className={classNames(styles.button, className, { [styles.active]: active, [styles.button_wide]: wide })}
            aria-label={props['aria-label'] ?? label}
        >
            {children}
            {wide && <span className={styles.button_label}>{label}</span>}
        </button>
    );
    return wide ? button : <Tooltip type="label" direction="e" text={label}>{button}</Tooltip>;
};

/// An icon of the rail from the svg sprite
const NavRailIcon = (props: { icon: string }) => (
    <svg width="16px" height="16px" aria-hidden="true">
        <use xlinkHref={`${symbols}#${props.icon}`} />
    </svg>
);

/// The pages of the rail in the groups of the flavor, with a separator between the groups.
/// The pages that are not there yet are buttons that do nothing.
export const NavRailPages = (props: { wide: boolean }): React.ReactElement => {
    const flavor = useAppFlavor();
    const location = useLocation();
    const { mode } = useSessionViewMode();
    const openWorkbench = useOpenWorkbench();
    const openShell = useOpenShell();
    const onSessionPath = isWorkspacePath(location.pathname);
    const shellActive = onSessionPath && mode === SessionViewMode.Shell;
    const workspaceActive = onSessionPath && !shellActive;
    const renderPage = (page: AppFlavorRailPage) => {
        switch (page.type) {
            case 'workspace':
                return (
                    <NavRailButton key="workspace" label="Workspace" wide={props.wide} active={workspaceActive} aria-current={workspaceActive ? 'page' : undefined} onClick={openWorkbench}>
                        <NavRailIcon icon="compose_24" />
                    </NavRailButton>
                );
            case 'shell':
                return openShell == null ? null : (
                    <NavRailButton key="shell" label="Shell" wide={props.wide} active={shellActive} aria-current={shellActive ? 'page' : undefined} onClick={openShell}>
                        <NavRailIcon icon="command_palette_24" />
                    </NavRailButton>
                );
            case 'upcoming':
                return (
                    // Not disabled but aria-disabled, so that the tooltip still names the page
                    <NavRailButton key={page.label} label={page.label} wide={props.wide} className={styles.button_upcoming} aria-disabled="true">
                        <NavRailIcon icon={page.icon} />
                    </NavRailButton>
                );
        }
    };
    return (
        <>
            {flavor.railPages.map((group, i) => (
                <React.Fragment key={i}>
                    {i > 0 && <div className={styles.separator} role="separator" />}
                    {group.map(renderPage)}
                </React.Fragment>
            ))}
        </>
    );
};

/// The rail left of the page card that switches between the pages of the app.
/// The shell is a page of its own although it shows the current session.
/// The button at the bottom widens the rail to show the labels of the buttons.
export const NavRail = (): React.ReactElement => {
    const [wide, toggleWide] = useNavRailWide();
    return (
        // Electron excludes the buttons via the global no-drag rules
        <nav className={classNames(styles.rail, { [styles.rail_wide]: wide })} aria-label="Areas" data-electron-drag-region>
            <div className={styles.group}>
                <NavRailPages wide={wide} />
            </div>
            <div className={styles.group}>
                {/* The octicons show the sidebar on the right, flipped it sits on the left like the rail */}
                <NavRailButton label={wide ? 'Collapse' : 'Expand'} wide={wide} aria-expanded={wide} onClick={toggleWide}>
                    <svg className={styles.icon_flipped} width="16px" height="16px" aria-hidden="true">
                        <use xlinkHref={`${symbols}#${wide ? 'sidebar_collapse_24' : 'sidebar_expand_24'}`} />
                    </svg>
                </NavRailButton>
            </div>
        </nav>
    );
};

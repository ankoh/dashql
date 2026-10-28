import * as React from 'react';
import * as styles from './nav_rail.module.css';
import symbols from '@ankoh/dashql-svg-symbols';

import { useLocation } from 'react-router-dom';
import { Tooltip } from '../../ui/foundations/tooltip.js';
import { SESSION_PATH, SELECT_SESSION, useRouteContext, useRouterNavigate } from '../router/router.js';
import { SessionViewMode, useSessionViewMode } from '../session/ui/session_view_mode.js';
import { classNames } from '../../utils/classnames.js';

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

type NavRailButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
    label: string;
    active?: boolean;
    ref?: React.Ref<HTMLButtonElement>;
    children: React.ReactNode;
};

/// An icon button of the rail, labeled by a tooltip.
/// Spreads the props of an anchored overlay so the overlays of the navbar can open from the rail.
export const NavRailButton = ({ label, active, className, children, ...props }: NavRailButtonProps) => (
    <Tooltip type="label" direction="e" text={label}>
        <button
            {...props}
            type="button"
            className={classNames(styles.button, className, { [styles.active]: active })}
            aria-label={props['aria-label'] ?? label}
        >
            {children}
        </button>
    </Tooltip>
);

interface NavRailProps {
    /// Shown at the bottom, e.g. the actions of the navbar
    footer?: React.ReactNode;
}

/// The rail left of the page card that switches between the areas of the app and opens the overlays
export const NavRail = (props: NavRailProps): React.ReactElement => {
    const location = useLocation();
    const openWorkbench = useOpenWorkbench();
    const workspaceActive = isWorkspacePath(location.pathname);
    return (
        // Electron excludes the buttons via the global no-drag rules
        <nav className={styles.rail} aria-label="Areas" data-electron-drag-region>
            <div className={styles.group}>
                <NavRailButton label="Workspace" active={workspaceActive} aria-current={workspaceActive ? 'page' : undefined} onClick={openWorkbench}>
                    <svg width="16px" height="16px" aria-hidden="true">
                        <use xlinkHref={`${symbols}#database`} />
                    </svg>
                </NavRailButton>
            </div>
            {props.footer != null && <div className={styles.group}>{props.footer}</div>}
        </nav>
    );
};

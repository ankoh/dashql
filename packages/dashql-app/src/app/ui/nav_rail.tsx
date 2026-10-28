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

const NavRailButton = (props: { label: string; icon: string; active: boolean; onClick: () => void }) => (
    <Tooltip type="label" direction="e" text={props.label}>
        <button
            type="button"
            className={classNames(styles.button, { [styles.active]: props.active })}
            aria-label={props.label}
            aria-current={props.active ? 'page' : undefined}
            onClick={props.onClick}
        >
            <svg width="16px" height="16px" aria-hidden="true">
                <use xlinkHref={`${symbols}#${props.icon}`} />
            </svg>
        </button>
    </Tooltip>
);

/// The slim rail left of the page card that switches between the areas of the app
export const NavRail = (): React.ReactElement => {
    const location = useLocation();
    const openWorkbench = useOpenWorkbench();
    return (
        <nav className={styles.rail} aria-label="Areas">
            <div className={styles.group}>
                <NavRailButton label="Workspace" icon="file_directory_16" active={isWorkspacePath(location.pathname)} onClick={openWorkbench} />
            </div>
        </nav>
    );
};

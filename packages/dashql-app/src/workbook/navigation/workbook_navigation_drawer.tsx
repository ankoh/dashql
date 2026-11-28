import * as React from 'react';
import { XIcon } from '@akohn/dashql-react/components/symbol_icon';

import { Portal } from '@akohn/dashql-react/components/portal';
import { ButtonVariant, IconButton } from '@akohn/dashql-react/components/button';
import { useOverlay } from '@akohn/dashql-react/components/overlay';
import { useFocusTrap } from '@akohn/dashql-react/dom/focus';
import * as styles from './workbook_navigation_drawer.module.css';
import { NavRailPages } from '../../app/nav_rail.js';
import { DETACHED_NAV_BAR_ACTIONS, NavBarActions } from '../../app/navbar.js';
import { useRouteContext } from '../../app/router.js';

interface Props {
    open: boolean;
    onClose: () => void;
    returnFocusRef: React.RefObject<HTMLElement | null>;
    children: React.ReactNode;
}

export const WorkbookNavigationDrawer: React.FC<Props> = (props) => {
    const closeButtonRef = React.useRef<HTMLButtonElement>(null);
    const route = useRouteContext();
    const overlayRef = useOverlay({
        onEscape: props.onClose,
        onClickOutside: props.onClose,
        returnFocusRef: props.returnFocusRef,
        initialFocusRef: closeButtonRef,
    });
    useFocusTrap({
        containerRef: overlayRef as React.RefObject<HTMLElement>,
        initialFocusRef: closeButtonRef as React.RefObject<HTMLElement>,
        disabled: !props.open,
    });

    if (!props.open) return null;
    return (
        <Portal>
            <div>
                <div className={styles.backdrop} aria-hidden="true" />
                <aside ref={overlayRef} className={styles.drawer} role="dialog" aria-modal="true" aria-label="Workbook workbench">
                    <header className={styles.header}>
                        {/* A compact window has no rail and no stripe, their pages and overlays are here. A page of the
                            rail closes the drawer. */}
                        <nav className={styles.areas} aria-label="Areas" onClickCapture={props.onClose}>
                            <NavRailPages wide={false} />
                        </nav>
                        <NavBarActions workbookId={route.workbookId} className={`${DETACHED_NAV_BAR_ACTIONS} ${styles.actions}`} />
                        <IconButton ref={closeButtonRef} variant={ButtonVariant.Invisible} aria-label="Close workbook workbench" onClick={props.onClose}>
                            <XIcon />
                        </IconButton>
                    </header>
                    <div className={styles.body}>{props.children}</div>
                </aside>
            </div>
        </Portal>
    );
};

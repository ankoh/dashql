import * as React from 'react';
import { XIcon } from '@akohn/dashql-react/components/symbol_icon';

import { Portal } from '@akohn/dashql-react/components/portal';
import { ButtonVariant, IconButton } from '@akohn/dashql-react/components/button';
import { useOverlay } from '@akohn/dashql-react/components/overlay';
import { useFocusTrap } from '@akohn/dashql-react/dom/focus';
import * as styles from './workbook_navigation_drawer.module.css';

interface Props {
    open: boolean;
    onClose: () => void;
    returnFocusRef: React.RefObject<HTMLElement | null>;
    children: React.ReactNode;
}

export const WorkbookNavigationDrawer: React.FC<Props> = (props) => {
    const closeButtonRef = React.useRef<HTMLButtonElement>(null);
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

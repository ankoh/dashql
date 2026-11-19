import * as React from 'react';

/// The right click of a row that opens the action menu of the row.
/// The row spreads `onContextMenu`, its action menu registers its opener with `useRowContextMenuOpener`.
export interface RowContextMenu {
    /// The handler of the right click of the row
    onContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
    /// The opener of the action menu, null while no menu is registered
    openerRef: React.RefObject<(() => void) | null>;
}

/// Create the right click of a row
export function useRowContextMenu(): RowContextMenu {
    const openerRef = React.useRef<(() => void) | null>(null);
    const onContextMenu = React.useCallback((event: React.MouseEvent<HTMLElement>) => {
        const open = openerRef.current;
        if (open == null || !opensRowContextMenu(event)) return;
        event.preventDefault();
        open();
    }, []);
    return React.useMemo(() => ({ onContextMenu, openerRef }), [onContextMenu]);
}

/// Register the opener of the action menu of a row
export function useRowContextMenuOpener(menu: RowContextMenu | undefined, open: () => void): void {
    const openRef = React.useRef(open);
    openRef.current = open;
    React.useEffect(() => {
        if (menu == null) return;
        const opener = () => openRef.current();
        menu.openerRef.current = opener;
        return () => {
            if (menu.openerRef.current === opener) menu.openerRef.current = null;
        };
    }, [menu]);
}

// React bubbles the events of the portaled overlays through the row, those keep their own right click.
// Text fields and editors keep the native menu with copy and paste.
function opensRowContextMenu(event: React.MouseEvent<HTMLElement>): boolean {
    const target = event.target;
    if (!(target instanceof Element) || !event.currentTarget.contains(target)) return false;
    return target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') == null;
}

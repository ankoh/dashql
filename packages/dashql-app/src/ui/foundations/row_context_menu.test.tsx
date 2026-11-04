import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';

import { AnchoredOverlay } from './anchored_overlay.js';
import { type RowContextMenu, useRowContextMenu, useRowContextMenuOpener } from './row_context_menu.js';

const Menu: React.FC<{ name: string; contextMenu: RowContextMenu }> = (props) => {
    const [open, setOpen] = React.useState(false);
    useRowContextMenuOpener(props.contextMenu, () => setOpen(true));
    return (
        <AnchoredOverlay
            open={open}
            onOpen={() => setOpen(true)}
            onClose={() => setOpen(false)}
            renderAnchor={(anchorProps) => <button {...anchorProps} type="button">More</button>}
        >
            <div role="dialog" aria-label={`Actions for ${props.name}`}>
                <button type="button">Rename</button>
            </div>
        </AnchoredOverlay>
    );
};

const Row: React.FC<{ name: string }> = (props) => {
    const contextMenu = useRowContextMenu();
    return (
        <li data-testid={`row-${props.name}`} onContextMenu={contextMenu.onContextMenu}>
            <span>{props.name}</span>
            <input aria-label={`Name of ${props.name}`} />
            <Menu name={props.name} contextMenu={contextMenu} />
        </li>
    );
};

describe('useRowContextMenu', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        act(() => root.render(<ul><Row name="a" /><Row name="b" /></ul>));
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    function rightClick(target: Element): MouseEvent {
        const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
        act(() => { target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 2 })); });
        act(() => { target.dispatchEvent(event); });
        return event;
    }
    const menu = (name: string) => document.querySelector(`[role="dialog"][aria-label="Actions for ${name}"]`);
    const row = (name: string) => container.querySelector(`[data-testid="row-${name}"]`)!;

    it('opens the menu of the row on a right click and suppresses the native menu', () => {
        expect(menu('a')).toBeNull();
        const event = rightClick(row('a').querySelector('span')!);
        expect(event.defaultPrevented).toBe(true);
        expect(menu('a')).not.toBeNull();
    });

    it('closes the menu of another row on a right click', () => {
        rightClick(row('a'));
        expect(menu('a')).not.toBeNull();
        rightClick(row('b'));
        expect(menu('a')).toBeNull();
        expect(menu('b')).not.toBeNull();
    });

    it('keeps the native menu of text fields and of the open menu', () => {
        const event = rightClick(row('a').querySelector('input')!);
        expect(event.defaultPrevented).toBe(false);
        expect(menu('a')).toBeNull();

        rightClick(row('a'));
        const inside = rightClick(menu('a')!.querySelector('button')!);
        expect(inside.defaultPrevented).toBe(false);
        expect(menu('a')).not.toBeNull();
    });
});

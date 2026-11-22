import * as React from 'react';
import { act } from '../testing/react_act.js';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

import { KEYBOARD_STEP, PanelResizeHandle } from './panel_resize_handle.js';

function dispatchPointerEvent(target: EventTarget, type: string, init: PointerEventInit) {
    const event = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent;
    Object.defineProperties(event, {
        button: { value: init.button ?? 0 },
        clientX: { value: init.clientX ?? 0 },
        pointerId: { value: init.pointerId ?? 1 },
    });
    target.dispatchEvent(event);
}

/// The handle with the size in the state of a parent, like the page of a workbook holds it
const Harness: React.FC = () => {
    const [size, setSize] = React.useState(276);
    return <PanelResizeHandle size={size} minSize={200} maxSize={560} onResize={setSize} label="Resize sidebar" />;
};

describe('PanelResizeHandle', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    function renderHandle() {
        act(() => root.render(<Harness />));
        return container.querySelector<HTMLElement>('[role="separator"]')!;
    }

    it('exposes a vertical separator with the size of the panel', () => {
        const separator = renderHandle();

        expect(separator.getAttribute('aria-label')).toBe('Resize sidebar');
        expect(separator.getAttribute('aria-orientation')).toBe('vertical');
        expect(separator.getAttribute('aria-valuenow')).toBe('276');
        expect(separator.getAttribute('aria-valuemin')).toBe('200');
        expect(separator.getAttribute('aria-valuemax')).toBe('560');
    });

    it('resizes and clamps the panel while dragging', () => {
        const separator = renderHandle();

        act(() => {
            dispatchPointerEvent(separator, 'pointerdown', { pointerId: 4, clientX: 280 });
            dispatchPointerEvent(window, 'pointermove', { pointerId: 4, clientX: 380 });
        });
        expect(separator.getAttribute('aria-valuenow')).toBe('376');

        act(() => dispatchPointerEvent(window, 'pointermove', { pointerId: 4, clientX: 1000 }));
        expect(separator.getAttribute('aria-valuenow')).toBe('560');

        act(() => dispatchPointerEvent(window, 'pointermove', { pointerId: 4, clientX: 0 }));
        expect(separator.getAttribute('aria-valuenow')).toBe('200');

        act(() => dispatchPointerEvent(window, 'pointerup', { pointerId: 4, clientX: 0 }));
        // Moves after the release leave the panel as it is
        act(() => dispatchPointerEvent(window, 'pointermove', { pointerId: 4, clientX: 380 }));
        expect(separator.getAttribute('aria-valuenow')).toBe('200');
    });

    it('ignores a click without dragging', () => {
        const separator = renderHandle();

        act(() => {
            dispatchPointerEvent(separator, 'pointerdown', { pointerId: 9, clientX: 280 });
            dispatchPointerEvent(window, 'pointermove', { pointerId: 9, clientX: 281 });
            dispatchPointerEvent(window, 'pointerup', { pointerId: 9, clientX: 281 });
        });

        expect(separator.getAttribute('aria-valuenow')).toBe('276');
    });

    it('restores the previous size after pointer cancellation', () => {
        const separator = renderHandle();

        act(() => {
            dispatchPointerEvent(separator, 'pointerdown', { pointerId: 7, clientX: 280 });
            dispatchPointerEvent(window, 'pointermove', { pointerId: 7, clientX: 400 });
        });
        expect(separator.getAttribute('aria-valuenow')).toBe('396');

        act(() => dispatchPointerEvent(window, 'pointercancel', { pointerId: 7, clientX: 400 }));
        expect(separator.getAttribute('aria-valuenow')).toBe('276');
    });

    it('supports keyboard resizing', () => {
        const separator = renderHandle();

        act(() => separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
        expect(separator.getAttribute('aria-valuenow')).toBe(String(276 + KEYBOARD_STEP));

        act(() => separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
        expect(separator.getAttribute('aria-valuenow')).toBe('276');

        act(() => separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
        expect(separator.getAttribute('aria-valuenow')).toBe('200');

        act(() => separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })));
        expect(separator.getAttribute('aria-valuenow')).toBe('560');
    });
});

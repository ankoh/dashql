import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { act } from '../testing/react_act.js';
import { createTestRoot } from '../testing/react_root.js';
import { Sheet } from './sheet.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

describe('Sheet', () => {
    let root: ReturnType<typeof createTestRoot>;
    beforeEach(() => { root = createTestRoot(); });
    afterEach(() => root.unmount());

    const dialog = () => document.querySelector<HTMLElement>('[data-testid="sheet"]');

    it('is a dialog named by its title, with its actions and content', () => {
        root.render(
            <Sheet title="Row 3 of 200" onClose={vi.fn()} actions={<button data-testid="next">Next</button>} data-testid="sheet">
                <p data-testid="content">East</p>
            </Sheet>,
        );
        const sheet = dialog()!;
        expect(sheet.getAttribute('role')).toBe('dialog');
        expect(document.getElementById(sheet.getAttribute('aria-labelledby')!)!.textContent).toBe('Row 3 of 200');
        expect(sheet.querySelector('[data-testid="next"]')).not.toBeNull();
        expect(sheet.querySelector('[data-testid="content"]')!.textContent).toBe('East');
        // The close button takes the focus
        expect(document.activeElement).toBe(sheet.querySelector('[data-testid="sheet-close"]'));
    });

    // Escape and a click outside close it through useOverlay, like the other overlays
    it('closes with its button', () => {
        const onClose = vi.fn();
        root.render(<Sheet title="Lineage" onClose={onClose} data-testid="sheet" />);
        act(() => dialog()!.querySelector<HTMLButtonElement>('[data-testid="sheet-close"]')!.click());
        expect(onClose).toHaveBeenCalledOnce();
    });
});

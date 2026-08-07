import { afterEach, describe, expect, it, vi } from 'vitest';

import { prepareForNotebookTreeNavigation } from './notebook_navigation_keyboard.js';

describe('prepareForNotebookTreeNavigation', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('prevents the browser shortcut and clears native button focus', () => {
        const button = document.createElement('button');
        document.body.appendChild(button);
        button.focus();
        const event = new KeyboardEvent('keydown', { key: 'j', ctrlKey: true, cancelable: true });
        const preventDefault = vi.spyOn(event, 'preventDefault');

        prepareForNotebookTreeNavigation(event);

        expect(preventDefault).toHaveBeenCalledOnce();
        expect(document.activeElement).toBe(document.body);
    });

    it('does not blur text input focus', () => {
        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();

        prepareForNotebookTreeNavigation(new KeyboardEvent('keydown', { cancelable: true }));

        expect(document.activeElement).toBe(input);
    });
});

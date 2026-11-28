import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { waitForRender } from '../testing/react_act.js';
import { createTestRoot } from '../testing/react_root.js';
import { ButtonSize, ButtonVariant } from './button.js';
import { CopyToClipboardButton } from './clipboard.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

describe('CopyToClipboardButton', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('logs without a logger of the host', async () => {
        const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
        const root = createTestRoot();
        try {
            await root.render(
                <CopyToClipboardButton
                    variant={ButtonVariant.Invisible}
                    size={ButtonSize.Small}
                    value="text"
                    logContext="test"
                    aria-label="Copy"
                    aria-labelledby=""
                />,
            );
            const before = root.container.innerHTML;
            root.container.querySelector('button')!.click();
            // The icon turns into a check only after the copy logged
            await waitForRender(() => expect(root.container.innerHTML).not.toBe(before));
            expect(writeText).toHaveBeenCalledWith('text');
        } finally {
            root.unmount();
        }
    });
});

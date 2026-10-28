import { describe, expect, it } from 'vitest';

import { isWorkspacePath } from './nav_rail.js';

describe('Nav rail', () => {
    it('marks the session pages as the workspace', () => {
        expect(isWorkspacePath('/')).toBe(true);
        expect(isWorkspacePath('/session')).toBe(true);
        expect(isWorkspacePath('/sessions/abc')).toBe(true);
    });

    it('leaves other pages outside the workspace', () => {
        expect(isWorkspacePath('/demo/ui')).toBe(false);
        expect(isWorkspacePath('/sessionsx')).toBe(false);
    });
});

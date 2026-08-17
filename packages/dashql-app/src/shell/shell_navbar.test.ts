import { describe, expect, it } from 'vitest';

import { formatNavbarEngineVersion } from './shell_navbar.js';

describe('formatNavbarEngineVersion', () => {
    it('keeps version labels unchanged', () => {
        expect(formatNavbarEngineVersion('Hyper 9.1.0 emulation, hyper version 9.1.0')).toBe(
            'Hyper 9.1.0 emulation, hyper version 9.1.0',
        );
    });

    it('collapses unversioned Hyper labels', () => {
        expect(formatNavbarEngineVersion(
            'Hyper 9.1.0 emulation, hyper version __UNVERSIONED_HYPER__.0.0.0.r00000000',
        )).toBe('Hyper 9.1.0 emulation, unversioned');
    });
});

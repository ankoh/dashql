import { getMacArchitectureLabel } from './release_bundle.js';

describe('getMacArchitectureLabel', () => {
    it('uses user-facing names for macOS architectures', () => {
        expect(getMacArchitectureLabel(['darwin-aarch64'])).toBe('Apple Silicon');
        expect(getMacArchitectureLabel(['darwin-x86_64'])).toBe('Intel');
    });

    it('falls back for bundles without a recognized macOS architecture', () => {
        expect(getMacArchitectureLabel([])).toBeNull();
        expect(getMacArchitectureLabel(['windows-x86_64'])).toBeNull();
    });
});

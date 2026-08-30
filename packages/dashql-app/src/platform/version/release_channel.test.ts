import { afterEach, describe, expect, it, vi } from 'vitest';

import { Logger } from '../logger/logger.js';
import { compareReleaseVersions, detectReleaseChannel, loadReleaseManifest } from './web_version_check.js';

class NullLogger extends Logger {
    public destroy(): void { }
    protected flushPendingRecords(): void { }
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('detectReleaseChannel', () => {
    it('classifies plain semver versions as stable', () => {
        expect(detectReleaseChannel('0.0.2')).toBe('stable');
        expect(detectReleaseChannel('1.2.3')).toBe('stable');
        expect(detectReleaseChannel('10.20.30')).toBe('stable');
    });

    it('classifies prerelease (dev) versions as canary', () => {
        expect(detectReleaseChannel('0.0.2-dev.17')).toBe('canary');
        expect(detectReleaseChannel('1.2.3-dev.1')).toBe('canary');
    });
});

describe('compareReleaseVersions', () => {
    const sign = (x: number) => (x < 0 ? -1 : x > 0 ? 1 : 0);

    it('orders by core version', () => {
        expect(sign(compareReleaseVersions('0.0.2', '0.0.3'))).toBe(-1);
        expect(sign(compareReleaseVersions('0.1.0', '0.0.9'))).toBe(1);
        expect(sign(compareReleaseVersions('1.0.0', '1.0.0'))).toBe(0);
    });

    it('ranks a release above its own prerelease', () => {
        expect(sign(compareReleaseVersions('0.0.3', '0.0.3-dev.1'))).toBe(1);
        expect(sign(compareReleaseVersions('0.0.3-dev.1', '0.0.3'))).toBe(-1);
    });

    it('orders prerelease iterations numerically', () => {
        expect(sign(compareReleaseVersions('0.0.3-dev.2', '0.0.3-dev.10'))).toBe(-1);
        expect(sign(compareReleaseVersions('0.0.3-dev.10', '0.0.3-dev.2'))).toBe(1);
    });

    it('treats an older stable as a downgrade from a newer canary', () => {
        // Installing stable 0.0.2 while on canary 0.0.3-dev.5 must not be an upgrade
        expect(compareReleaseVersions('0.0.2', '0.0.3-dev.5')).toBeLessThan(0);
        // The canary of the next core version is an upgrade over the current stable
        expect(compareReleaseVersions('0.0.3-dev.5', '0.0.2')).toBeGreaterThan(0);
    });
});

describe('loadReleaseManifest', () => {
    it('bypasses the browser cache for mutable channel manifests', async () => {
        const manifest = {
            release_id: 'release-id',
            pub_date: '2026-08-30T12:26:06Z',
            version: '0.0.8',
            git_commit_hash: 'e0e35fe',
            git_commit_url: 'https://github.com/ankoh/dashql/tree/e0e35fe',
            update_manifest_url: 'https://get.dashql.app/releases/0.0.8/update.json',
            bundles: [],
        };
        const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(manifest)));
        vi.stubGlobal('fetch', fetch);
        const url = new URL('https://get.dashql.app/stable.json');

        await loadReleaseManifest('stable', url, new NullLogger());

        expect(fetch).toHaveBeenCalledWith(url, {cache: 'no-store'});
    });
});

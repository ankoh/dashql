import * as React from 'react';

import { useLogger } from '../logger/logger_provider.js';
import { awaitAndSet, Result, RESULT_ERROR, RESULT_OK } from '../../utils/result.js';
import { Logger, stringifyError } from '../logger/logger.js';
import { createTrace } from '../logger/trace_context.js';
import { DASHQL_CANARY_RELEASE_MANIFEST, DASHQL_STABLE_RELEASE_MANIFEST } from '../../globals.js';
import { CANARY_RELEASE_MANIFEST_CTX, CANARY_UPDATE_MANIFEST_CTX, INSTALLATION_STATUS_CTX, STABLE_RELEASE_MANIFEST_CTX, STABLE_UPDATE_MANIFEST_CTX, VERSION_CHECK_CTX, VERSION_CHECK_REFRESH_CTX, VersionCheckStatusCode } from './version_check.js';

const LOG_CTX = "version_check";

type Props = {
    children: React.ReactElement;
};

/// A release bundle
export interface ReleaseBundle {
    url: URL;
    signature: string | null;
    name: string;
    bundle_type: string;
    targets: string[];
}

/// A release manifest
export interface ReleaseManifest {
    release_id: string;
    pub_date: Date;
    version: string;
    git_commit_hash: string;
    git_commit_url: string;
    update_manifest_url: string;
    bundles: ReleaseBundle[];
}

function parseReleaseManifest(raw: any): ReleaseManifest {
    if (raw.pub_date) {
        raw.pub_date = new Date(Date.parse(raw.pub_date));
    }
    for (const bundle of raw.bundles) {
        bundle.url = new URL(bundle.url);
    }
    return raw as ReleaseManifest;
}

/// A release channel
export type ReleaseChannel = "stable" | "canary";

/// Detect the release channel of an installed version from its version scheme.
///
/// Releases are versioned as `MAJOR.MINOR.PATCH` for stable builds and
/// `MAJOR.MINOR.PATCH-dev.N` for canary builds (see `bazel/versioning.bzl` and
/// `dashql-pack/src/release_version.rs`, which derive the channel from the git iteration).
/// A prerelease suffix therefore uniquely identifies a canary build.
export function detectReleaseChannel(version: string): ReleaseChannel {
    return version.includes("-") ? "canary" : "stable";
}

interface ParsedVersion {
    major: number;
    minor: number;
    patch: number;
    prerelease: string | null;
}

function parseVersion(version: string): ParsedVersion {
    const [core, prerelease] = version.split("-", 2);
    const [major, minor, patch] = core.split(".").map(x => parseInt(x, 10) || 0);
    return { major, minor, patch, prerelease: prerelease ?? null };
}

/// Compare the dot-separated identifiers of two semver prerelease strings (e.g. "dev.5").
function comparePrerelease(a: string, b: string): number {
    const as = a.split(".");
    const bs = b.split(".");
    const n = Math.max(as.length, bs.length);
    for (let i = 0; i < n; ++i) {
        const ai = as[i];
        const bi = bs[i];
        // A smaller set of prerelease fields has lower precedence
        if (ai === undefined) return -1;
        if (bi === undefined) return 1;
        const aNum = /^\d+$/.test(ai);
        const bNum = /^\d+$/.test(bi);
        if (aNum && bNum) {
            const x = parseInt(ai, 10);
            const y = parseInt(bi, 10);
            if (x !== y) return x < y ? -1 : 1;
        } else if (aNum !== bNum) {
            // Numeric identifiers always have lower precedence than non-numeric ones
            return aNum ? -1 : 1;
        } else if (ai !== bi) {
            return ai < bi ? -1 : 1;
        }
    }
    return 0;
}

/// Compare two release versions following semver precedence.
/// Returns a negative number if `a < b`, zero if equal, and a positive number if `a > b`.
export function compareReleaseVersions(a: string, b: string): number {
    const pa = parseVersion(a);
    const pb = parseVersion(b);
    if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
    if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
    if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;
    // Equal core version: a build without a prerelease suffix outranks a prerelease of the same core
    if (pa.prerelease == null && pb.prerelease == null) return 0;
    if (pa.prerelease == null) return 1;
    if (pb.prerelease == null) return -1;
    return comparePrerelease(pa.prerelease, pb.prerelease);
}

/// Load the release manifest
export async function loadReleaseManifest(channel: ReleaseChannel, url: URL, logger: Logger): Promise<ReleaseManifest> {
    const traced = logger.withTrace(createTrace());
    const start = performance.now();
    traced.info(`Fetching release manifest`, { "channel": channel }, LOG_CTX);
    try {
        // Fetch the release manifest
        const manifestRequest = await fetch(url, {cache: "no-store"});
        const manifestRaw = (await manifestRequest.json());
        const manifest = parseReleaseManifest(manifestRaw);
        // Set release manifest
        const end = performance.now();
        traced.info(`Fetched release manifest`, { "channel": channel, "duration": Math.floor(end - start).toString() }, LOG_CTX);
        return manifest;
    } catch (e: any) {
        const end = performance.now();
        traced.warn(`Failed to fetch release manifest`, { "channel": channel, "duration": Math.floor(end - start).toString(), "error": stringifyError(e) }, LOG_CTX);
        throw e;
    }
}

export const WebVersionCheck: React.FC<Props> = (props: Props) => {
    const logger = useLogger();

    const [stableRelease, setStableRelease] = React.useState<Result<ReleaseManifest> | null>(null);
    const [canaryRelease, setCanaryRelease] = React.useState<Result<ReleaseManifest> | null>(null);

    const refresh = React.useCallback(() => {
        awaitAndSet(loadReleaseManifest("stable", DASHQL_STABLE_RELEASE_MANIFEST, logger), setStableRelease);
        awaitAndSet(loadReleaseManifest("canary", DASHQL_CANARY_RELEASE_MANIFEST, logger), setCanaryRelease);
    }, [logger]);

    React.useEffect(() => {
        refresh();
    }, [refresh]);

    return (
        <VERSION_CHECK_CTX.Provider value={VersionCheckStatusCode.Disabled}>
            <VERSION_CHECK_REFRESH_CTX.Provider value={refresh}>
                <INSTALLATION_STATUS_CTX.Provider value={null}>
                    <STABLE_RELEASE_MANIFEST_CTX.Provider value={stableRelease}>
                        <STABLE_UPDATE_MANIFEST_CTX.Provider value={null}>
                            <CANARY_RELEASE_MANIFEST_CTX.Provider value={canaryRelease}>
                                <CANARY_UPDATE_MANIFEST_CTX.Provider value={null}>
                                    {props.children}
                                </CANARY_UPDATE_MANIFEST_CTX.Provider>
                            </CANARY_RELEASE_MANIFEST_CTX.Provider>
                        </STABLE_UPDATE_MANIFEST_CTX.Provider>
                    </STABLE_RELEASE_MANIFEST_CTX.Provider>
                </INSTALLATION_STATUS_CTX.Provider>
            </VERSION_CHECK_REFRESH_CTX.Provider>
        </VERSION_CHECK_CTX.Provider>
    );
};

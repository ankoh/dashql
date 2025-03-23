import * as React from 'react';

import { useLogger } from './logger_provider.js';
import { awaitAndSet, Result, RESULT_ERROR, RESULT_OK } from '../utils/result.js';
import { Logger } from './logger.js';
import { DASHQL_CANARY_RELEASE_MANIFEST, DASHQL_STABLE_RELEASE_MANIFEST } from '../globals.js';
import { CANARY_RELEASE_MANIFEST_CTX, CANARY_UPDATE_MANIFEST_CTX, INSTALLATION_STATUS_CTX, STABLE_RELEASE_MANIFEST_CTX, STABLE_UPDATE_MANIFEST_CTX, VERSION_CHECK_CTX, VersionCheckStatusCode } from './version_check.js';

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

/// Load the release manifest
export async function loadReleaseManifest(channel: ReleaseChannel, url: URL, logger: Logger): Promise<ReleaseManifest> {
    const start = performance.now();
    logger.info(`fetching release manifest`, { "channel": channel }, LOG_CTX);
    try {
        // Fetch the release manifest
        const manifestRequest = await fetch(url);
        const manifestRaw = (await manifestRequest.json());
        const manifest = parseReleaseManifest(manifestRaw);
        // Set release manifest
        const end = performance.now();
        logger.info(`fetched release manifest`, { "channel": channel, "duration": Math.floor(end - start).toString() }, LOG_CTX);
        return manifest;
    } catch (e: any) {
        const end = performance.now();
        logger.error(`failed to fetch release manifest`, { "channel": channel, "duration": Math.floor(end - start).toString(), "error": e.toString() }, LOG_CTX);
        throw e;
    }
}

export const WebVersionCheck: React.FC<Props> = (props: Props) => {
    const logger = useLogger();

    const [stableRelease, setStableRelease] = React.useState<Result<ReleaseManifest> | null>(null);
    const [canaryRelease, setCanaryRelease] = React.useState<Result<ReleaseManifest> | null>(null);

    React.useEffect(() => {
        awaitAndSet(loadReleaseManifest("stable", DASHQL_STABLE_RELEASE_MANIFEST, logger), setStableRelease);
        awaitAndSet(loadReleaseManifest("canary", DASHQL_CANARY_RELEASE_MANIFEST, logger), setCanaryRelease);
    }, []);

    return (
        <VERSION_CHECK_CTX.Provider value={VersionCheckStatusCode.Disabled}>
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
        </VERSION_CHECK_CTX.Provider>
    );
};

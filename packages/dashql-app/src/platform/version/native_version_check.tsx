import * as React from 'react';

import { check, DownloadEvent, Update } from '@tauri-apps/plugin-updater';

import { useLogger } from '../logger/logger_provider.js';
import { awaitAndSet, Result, RESULT_OK } from '../../utils/result.js';
import { Logger, stringifyError } from '../logger/logger.js';
import { compareReleaseVersions, detectReleaseChannel, loadReleaseManifest, ReleaseChannel, ReleaseManifest } from './web_version_check.js';
import { DASHQL_CANARY_RELEASE_MANIFEST, DASHQL_STABLE_RELEASE_MANIFEST, DASHQL_VERSION } from '../../globals.js';
import { STABLE_RELEASE_MANIFEST_CTX, STABLE_UPDATE_MANIFEST_CTX, CANARY_RELEASE_MANIFEST_CTX, CANARY_UPDATE_MANIFEST_CTX, VERSION_CHECK_CTX, VersionCheckStatusCode, InstallableUpdate, InstallationStatusSetter, InstallationStatusCode, InstallationState, INSTALLATION_STATUS_CTX } from './version_check.js';

class InstallableTauriUpdate implements InstallableUpdate {
    /// The logger
    logger: Logger;
    /// Update the installation status
    update: Update;
    /// Set the installation status
    setInstallationState: (setter: InstallationStatusSetter) => void;

    constructor(update: Update, setState: (setter: InstallationStatusSetter) => void, logger: Logger) {
        this.logger = logger;
        this.update = update;
        this.setInstallationState = setState;
    }
    /// Download and install
    public async download() {
        try {
            await this.update.downloadAndInstall((progress: DownloadEvent) => {
                switch (progress.event) {
                    case "Started":
                        this.setInstallationState(_ => ({
                            update: this,
                            statusCode: InstallationStatusCode.Started,
                            totalBytes: progress.data.contentLength ?? null,
                            loadedBytes: 0,
                            inProgressBytes: 0,
                            error: null,
                        }));
                        break;
                    case "Progress":
                        this.setInstallationState(s => ({
                            update: this,
                            statusCode: InstallationStatusCode.InProgress,
                            totalBytes: s?.totalBytes ?? 0,
                            loadedBytes: (s?.loadedBytes ?? 0) + (s?.inProgressBytes ?? 0),
                            inProgressBytes: progress.data.chunkLength,
                            error: null,
                        }));
                        break;
                    case "Finished": {
                        this.setInstallationState(s => {
                            const totalBytes = s?.totalBytes ?? 0;
                            return {
                                update: this,
                                statusCode: InstallationStatusCode.RestartPending,
                                totalBytes: totalBytes,
                                loadedBytes: (totalBytes > 0) ? totalBytes : (s?.loadedBytes ?? (s?.inProgressBytes ?? 0)),
                                inProgressBytes: 0,
                                error: null,
                            };
                        });
                        break;
                    }
                }
            });
        } catch (e: unknown) {
            const err = e instanceof Error ? e : new Error(stringifyError(e));
            this.setInstallationState(s => {
                return {
                    update: this,
                    statusCode: InstallationStatusCode.Failed,
                    totalBytes: s?.totalBytes ?? 0,
                    loadedBytes: s?.loadedBytes ?? 0,
                    inProgressBytes: s?.inProgressBytes ?? 0,
                    error: err,
                };
            });
        }
    }
}

/// Check for updates using the tauri updater
async function checkChannelUpdates(channel: ReleaseChannel, setInstallationStatus: (setter: InstallationStatusSetter) => void, logger: Logger) {
    const start = performance.now();
    try {
        logger.info(`Checking for channel updates`, { "channel": channel }, "version_check");
        const update = await check({
            headers: {
                "dashql-channel": channel
            }
        });
        const end = performance.now();
        logger.info(`Checking for channel updates succeeded`, { "channel": channel, "duration": Math.floor(end - start).toString() }, "version_check");
        return update == null ? null : new InstallableTauriUpdate(update, setInstallationStatus, logger);
    } catch (e: any) {
        const err = e instanceof Error ? e : new Error(stringifyError(e));
        const end = performance.now();
        logger.error(`Checking for channel updates failed`, { "channel": channel, "duration": Math.floor(end - start).toString(), "error": stringifyError(e) }, "version_check");
        throw err;
    }
}


type Props = {
    children: React.ReactElement;
};

export const NativeVersionCheck: React.FC<Props> = (props: Props) => {
    const logger = useLogger();

    // It is actually redundant to fetch the dedicated release manifest just for the UI as well.
    // Let's check if we can contribute upstream if `check` can return version information also if there's no newer version available.

    const [stableRelease, setStableRelease] = React.useState<Result<ReleaseManifest> | null>(null);
    const [stableUpdate, setStableUpdate] = React.useState<Result<InstallableTauriUpdate | null> | null>(null);
    const [canaryRelease, setCanaryRelease] = React.useState<Result<ReleaseManifest> | null>(null);
    const [canaryUpdate, setCanaryUpdate] = React.useState<Result<InstallableTauriUpdate | null> | null>(null);
    const [installationStatus, setInstallationStatus] = React.useState<InstallationState | null>(null);

    React.useEffect(() => {
        awaitAndSet(loadReleaseManifest("stable", DASHQL_STABLE_RELEASE_MANIFEST, logger), setStableRelease);
        awaitAndSet(loadReleaseManifest("canary", DASHQL_CANARY_RELEASE_MANIFEST, logger), setCanaryRelease);
        awaitAndSet(checkChannelUpdates("stable", setInstallationStatus, logger), setStableUpdate);
        awaitAndSet(checkChannelUpdates("canary", setInstallationStatus, logger), setCanaryUpdate);
    }, []);

    // The channel the app currently tracks for the update indicator.
    // It is fully dictated by the installed version scheme.
    const activeChannel = detectReleaseChannel(DASHQL_VERSION);
    const activeRelease = activeChannel == "canary" ? canaryRelease : stableRelease;
    const activeUpdate = activeChannel == "canary" ? canaryUpdate : stableUpdate;

    // Derive the version check status from the active channel only.
    // We only surface the update indicator for the channel the user is on, but any ongoing
    // installation (which may target another channel that the user just switched to) still wins.
    //
    // The indicator is driven by the release manifest (the same signal the version overlay shows),
    // comparing the advertised version against the installed one ourselves. This keeps the navbar and
    // the overlay consistent and independent of the tauri `check()` round-trip, and we only signal a
    // strict upgrade so we never nudge towards a downgrade.
    let status = VersionCheckStatusCode.Unknown;
    if (activeRelease != null && activeRelease.type == RESULT_OK) {
        const advertised = activeRelease.value.version;
        status = compareReleaseVersions(advertised, DASHQL_VERSION) > 0
            ? VersionCheckStatusCode.UpdateAvailable
            : VersionCheckStatusCode.UpToDate;
    }
    // Fall back to the tauri check if the manifest is unavailable.
    if (status == VersionCheckStatusCode.Unknown && activeUpdate != null && activeUpdate.type == RESULT_OK) {
        status = activeUpdate.value != null
            ? VersionCheckStatusCode.UpdateAvailable
            : VersionCheckStatusCode.UpToDate;
    }
    // An installation always reflects the update the user actually triggered, regardless of channel.
    // TODO consolidate error handling for updates
    if (installationStatus != null) {
        switch (installationStatus.statusCode) {
            case InstallationStatusCode.Started:
            case InstallationStatusCode.InProgress:
                status = VersionCheckStatusCode.UpdateInstalling;
                break;
            case InstallationStatusCode.RestartPending:
                status = VersionCheckStatusCode.RestartPending;
                break;
            case InstallationStatusCode.Failed:
                status = VersionCheckStatusCode.UpdateFailed;
                break;
        }
    }
    return (
        <VERSION_CHECK_CTX.Provider value={status}>
            <INSTALLATION_STATUS_CTX.Provider value={installationStatus}>
                <STABLE_RELEASE_MANIFEST_CTX.Provider value={stableRelease}>
                    <STABLE_UPDATE_MANIFEST_CTX.Provider value={stableUpdate}>
                        <CANARY_RELEASE_MANIFEST_CTX.Provider value={canaryRelease}>
                            <CANARY_UPDATE_MANIFEST_CTX.Provider value={canaryUpdate}>
                                {props.children}
                            </CANARY_UPDATE_MANIFEST_CTX.Provider>
                        </CANARY_RELEASE_MANIFEST_CTX.Provider>
                    </STABLE_UPDATE_MANIFEST_CTX.Provider>
                </STABLE_RELEASE_MANIFEST_CTX.Provider>
            </INSTALLATION_STATUS_CTX.Provider>
        </VERSION_CHECK_CTX.Provider>
    );
};


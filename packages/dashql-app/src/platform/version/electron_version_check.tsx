import * as React from 'react';

import { DASHQL_LATEST_RELEASE_MANIFEST, DASHQL_STABLE_RELEASE_MANIFEST } from '../../globals.js';
import { RESULT_ERROR, RESULT_OK, Result } from '../../utils/result.js';
import { useLogger } from '../logger/logger_provider.js';
import {
    LATEST_RELEASE_MANIFEST_CTX,
    LATEST_UPDATE_MANIFEST_CTX,
    INSTALLATION_STATUS_CTX,
    InstallableUpdate,
    InstallationState,
    InstallationStatusCode,
    STABLE_RELEASE_MANIFEST_CTX,
    STABLE_UPDATE_MANIFEST_CTX,
    VERSION_CHECK_CTX,
    VERSION_CHECK_REFRESH_CTX,
    VersionCheckStatusCode,
    useVersionCheckRefreshState,
} from './version_check.js';
import { detectReleaseChannel, loadReleaseManifest, ReleaseChannel, ReleaseManifest } from './web_version_check.js';
import { DASHQL_VERSION } from '../../globals.js';

type Props = {children: React.ReactElement};

export const ElectronVersionCheck: React.FC<Props> = ({children}) => {
    const logger = useLogger();
    const bridge = globalThis.dashqlElectron!.updates;
    const activeChannel = detectReleaseChannel(DASHQL_VERSION);
    const [status, setStatus] = React.useState<VersionCheckStatusCode>(VersionCheckStatusCode.Unknown);
    const [installation, setInstallation] = React.useState<InstallationState | null>(null);
    const [stableRelease, setStableRelease] = React.useState<Result<ReleaseManifest> | null>(null);
    const [latestRelease, setLatestRelease] = React.useState<Result<ReleaseManifest> | null>(null);
    const updateRef = React.useRef<Record<ReleaseChannel, InstallableUpdate> | null>(null);

    if (updateRef.current === null) {
        updateRef.current = {
            stable: {download: async () => await bridge.download('stable')},
            latest: {download: async () => await bridge.download('latest')},
        };
    }
    const updates = updateRef.current;
    const [stableUpdate, setStableUpdate] = React.useState<Result<InstallableUpdate | null> | null>(null);
    const [latestUpdate, setLatestUpdate] = React.useState<Result<InstallableUpdate | null> | null>(null);

    const applyStatus = React.useEffectEvent((next: DashQLElectronUpdateStatus) => {
        switch (next.status) {
            case 'disabled':
                setStatus(VersionCheckStatusCode.Disabled);
                if (activeChannel === 'latest') {
                    setLatestUpdate({type: RESULT_OK, value: null});
                } else {
                    setStableUpdate({type: RESULT_OK, value: null});
                }
                break;
            case 'checking':
                setStatus(VersionCheckStatusCode.Unknown);
                break;
            case 'up-to-date':
                setStatus(VersionCheckStatusCode.UpToDate);
                if (next.channel === 'latest') {
                    setLatestUpdate({type: RESULT_OK, value: null});
                } else {
                    setStableUpdate({type: RESULT_OK, value: null});
                }
                break;
            case 'available':
                setStatus(VersionCheckStatusCode.UpdateAvailable);
                if (next.channel === 'latest') {
                    setLatestUpdate({type: RESULT_OK, value: updates.latest});
                } else {
                    setStableUpdate({type: RESULT_OK, value: updates.stable});
                }
                break;
            case 'downloading':
                setStatus(VersionCheckStatusCode.UpdateInstalling);
                setInstallation({
                    update: updates[next.channel],
                    statusCode: InstallationStatusCode.InProgress,
                    totalBytes: next.total,
                    loadedBytes: next.transferred,
                    inProgressBytes: 0,
                    error: null,
                });
                break;
            case 'downloaded':
                setStatus(VersionCheckStatusCode.RestartPending);
                setInstallation({
                    update: updates[next.channel],
                    statusCode: InstallationStatusCode.RestartPending,
                    totalBytes: null,
                    loadedBytes: 0,
                    inProgressBytes: 0,
                    error: null,
                });
                break;
            case 'error': {
                const error = new Error(next.message);
                setStatus(VersionCheckStatusCode.UpdateFailed);
                if (next.channel === 'latest') {
                    setLatestUpdate({type: RESULT_ERROR, error});
                } else {
                    setStableUpdate({type: RESULT_ERROR, error});
                }
                setInstallation((current) => current === null ? null : {
                    ...current,
                    statusCode: InstallationStatusCode.Failed,
                    error,
                });
                break;
            }
        }
    });

    const check = React.useCallback(async () => {
        await Promise.all([
            loadReleaseManifest('stable', DASHQL_STABLE_RELEASE_MANIFEST, logger)
                .then(value => setStableRelease({type: RESULT_OK, value}))
                .catch(error => setStableRelease({type: RESULT_ERROR, error})),
            loadReleaseManifest('latest', DASHQL_LATEST_RELEASE_MANIFEST, logger)
                .then(value => setLatestRelease({type: RESULT_OK, value}))
                .catch(error => setLatestRelease({type: RESULT_ERROR, error})),
            bridge.check(activeChannel)
                .then(applyStatus)
                .catch(error => applyStatus({status: 'error', channel: activeChannel, message: String(error)})),
        ]);
    }, [bridge, logger]);
    const refresh = useVersionCheckRefreshState(check);

    React.useEffect(() => {
        const unsubscribe = bridge.onStatus(applyStatus);
        void bridge.getStatus().then(applyStatus);
        return unsubscribe;
    }, [bridge]);

    const stableInstallableUpdate = stableUpdate ?? (activeChannel === 'latest' ? {type: RESULT_OK, value: updates.stable} as const : null);
    const latestInstallableUpdate = latestUpdate ?? (activeChannel === 'stable' ? {type: RESULT_OK, value: updates.latest} as const : null);
    return (
        <VERSION_CHECK_CTX.Provider value={status}>
            <VERSION_CHECK_REFRESH_CTX.Provider value={refresh}>
                <INSTALLATION_STATUS_CTX.Provider value={installation}>
                    <STABLE_RELEASE_MANIFEST_CTX.Provider value={stableRelease}>
                        <STABLE_UPDATE_MANIFEST_CTX.Provider value={stableInstallableUpdate}>
                            <LATEST_RELEASE_MANIFEST_CTX.Provider value={latestRelease}>
                                <LATEST_UPDATE_MANIFEST_CTX.Provider value={latestInstallableUpdate}>
                                    {children}
                                </LATEST_UPDATE_MANIFEST_CTX.Provider>
                            </LATEST_RELEASE_MANIFEST_CTX.Provider>
                        </STABLE_UPDATE_MANIFEST_CTX.Provider>
                    </STABLE_RELEASE_MANIFEST_CTX.Provider>
                </INSTALLATION_STATUS_CTX.Provider>
            </VERSION_CHECK_REFRESH_CTX.Provider>
        </VERSION_CHECK_CTX.Provider>
    );
};

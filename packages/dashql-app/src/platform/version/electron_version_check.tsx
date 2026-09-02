import * as React from 'react';

import { DASHQL_CANARY_RELEASE_MANIFEST, DASHQL_STABLE_RELEASE_MANIFEST } from '../../globals.js';
import { RESULT_ERROR, RESULT_OK, Result } from '../../utils/result.js';
import { useLogger } from '../logger/logger_provider.js';
import {
    CANARY_RELEASE_MANIFEST_CTX,
    CANARY_UPDATE_MANIFEST_CTX,
    INSTALLATION_STATUS_CTX,
    InstallableUpdate,
    InstallationState,
    InstallationStatusCode,
    STABLE_RELEASE_MANIFEST_CTX,
    STABLE_UPDATE_MANIFEST_CTX,
    VERSION_CHECK_CTX,
    VERSION_CHECK_REFRESH_CTX,
    VersionCheckStatusCode,
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
    const [canaryRelease, setCanaryRelease] = React.useState<Result<ReleaseManifest> | null>(null);
    const updateRef = React.useRef<Record<ReleaseChannel, InstallableUpdate> | null>(null);

    if (updateRef.current === null) {
        updateRef.current = {
            stable: {download: async () => await bridge.download('stable')},
            canary: {download: async () => await bridge.download('canary')},
        };
    }
    const updates = updateRef.current;
    const [stableUpdate, setStableUpdate] = React.useState<Result<InstallableUpdate | null> | null>(null);
    const [canaryUpdate, setCanaryUpdate] = React.useState<Result<InstallableUpdate | null> | null>(null);

    const applyStatus = React.useEffectEvent((next: DashQLElectronUpdateStatus) => {
        switch (next.status) {
            case 'disabled':
                setStatus(VersionCheckStatusCode.Disabled);
                if (activeChannel === 'canary') {
                    setCanaryUpdate({type: RESULT_OK, value: null});
                } else {
                    setStableUpdate({type: RESULT_OK, value: null});
                }
                break;
            case 'checking':
                setStatus(VersionCheckStatusCode.Unknown);
                break;
            case 'up-to-date':
                setStatus(VersionCheckStatusCode.UpToDate);
                if (next.channel === 'canary') {
                    setCanaryUpdate({type: RESULT_OK, value: null});
                } else {
                    setStableUpdate({type: RESULT_OK, value: null});
                }
                break;
            case 'available':
                setStatus(VersionCheckStatusCode.UpdateAvailable);
                if (next.channel === 'canary') {
                    setCanaryUpdate({type: RESULT_OK, value: updates.canary});
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
                if (next.channel === 'canary') {
                    setCanaryUpdate({type: RESULT_ERROR, error});
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

    const refresh = React.useCallback(() => {
        void loadReleaseManifest('stable', DASHQL_STABLE_RELEASE_MANIFEST, logger)
            .then(value => setStableRelease({type: RESULT_OK, value}))
            .catch(error => setStableRelease({type: RESULT_ERROR, error}));
        void loadReleaseManifest('canary', DASHQL_CANARY_RELEASE_MANIFEST, logger)
            .then(value => setCanaryRelease({type: RESULT_OK, value}))
            .catch(error => setCanaryRelease({type: RESULT_ERROR, error}));
        void bridge.check(activeChannel).then(applyStatus).catch(error => applyStatus({status: 'error', channel: activeChannel, message: String(error)}));
    }, [bridge, logger]);

    React.useEffect(() => {
        const unsubscribe = bridge.onStatus(applyStatus);
        void bridge.getStatus().then(applyStatus);
        refresh();
        return unsubscribe;
    }, [bridge, refresh]);

    const stableInstallableUpdate = stableUpdate ?? (activeChannel === 'canary' ? {type: RESULT_OK, value: updates.stable} as const : null);
    const canaryInstallableUpdate = canaryUpdate ?? (activeChannel === 'stable' ? {type: RESULT_OK, value: updates.canary} as const : null);
    return (
        <VERSION_CHECK_CTX.Provider value={status}>
            <VERSION_CHECK_REFRESH_CTX.Provider value={refresh}>
                <INSTALLATION_STATUS_CTX.Provider value={installation}>
                    <STABLE_RELEASE_MANIFEST_CTX.Provider value={stableRelease}>
                        <STABLE_UPDATE_MANIFEST_CTX.Provider value={stableInstallableUpdate}>
                            <CANARY_RELEASE_MANIFEST_CTX.Provider value={canaryRelease}>
                                <CANARY_UPDATE_MANIFEST_CTX.Provider value={canaryInstallableUpdate}>
                                    {children}
                                </CANARY_UPDATE_MANIFEST_CTX.Provider>
                            </CANARY_RELEASE_MANIFEST_CTX.Provider>
                        </STABLE_UPDATE_MANIFEST_CTX.Provider>
                    </STABLE_RELEASE_MANIFEST_CTX.Provider>
                </INSTALLATION_STATUS_CTX.Provider>
            </VERSION_CHECK_REFRESH_CTX.Provider>
        </VERSION_CHECK_CTX.Provider>
    );
};

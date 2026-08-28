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
import { detectReleaseChannel, loadReleaseManifest, ReleaseManifest } from './web_version_check.js';
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
    const updateRef = React.useRef<InstallableUpdate | null>(null);

    if (updateRef.current === null) {
        updateRef.current = {download: async () => await bridge.download()};
    }
    const update = updateRef.current;
    const [activeUpdate, setActiveUpdate] = React.useState<Result<InstallableUpdate | null> | null>(null);

    const applyStatus = React.useEffectEvent((next: DashQLElectronUpdateStatus) => {
        switch (next.status) {
            case 'disabled':
                setStatus(VersionCheckStatusCode.Disabled);
                setActiveUpdate({type: RESULT_OK, value: null});
                break;
            case 'checking':
                setStatus(VersionCheckStatusCode.Unknown);
                break;
            case 'up-to-date':
                setStatus(VersionCheckStatusCode.UpToDate);
                setActiveUpdate({type: RESULT_OK, value: null});
                break;
            case 'available':
                setStatus(VersionCheckStatusCode.UpdateAvailable);
                setActiveUpdate({type: RESULT_OK, value: update});
                break;
            case 'downloading':
                setStatus(VersionCheckStatusCode.UpdateInstalling);
                setInstallation({
                    update,
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
                    update,
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
                setActiveUpdate({type: RESULT_ERROR, error});
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
        void bridge.check().then(applyStatus).catch(error => applyStatus({status: 'error', message: String(error)}));
    }, [bridge, logger]);

    React.useEffect(() => {
        const unsubscribe = bridge.onStatus(applyStatus);
        void bridge.getStatus().then(applyStatus);
        refresh();
        return unsubscribe;
    }, [bridge, refresh]);

    const stableUpdate = activeChannel === 'stable' ? activeUpdate : {type: RESULT_OK, value: null} as const;
    const canaryUpdate = activeChannel === 'canary' ? activeUpdate : {type: RESULT_OK, value: null} as const;
    return (
        <VERSION_CHECK_CTX.Provider value={status}>
            <VERSION_CHECK_REFRESH_CTX.Provider value={refresh}>
                <INSTALLATION_STATUS_CTX.Provider value={installation}>
                    <STABLE_RELEASE_MANIFEST_CTX.Provider value={stableRelease}>
                        <STABLE_UPDATE_MANIFEST_CTX.Provider value={stableUpdate}>
                            <CANARY_RELEASE_MANIFEST_CTX.Provider value={canaryRelease}>
                                <CANARY_UPDATE_MANIFEST_CTX.Provider value={canaryUpdate}>
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

import * as React from 'react';

import { ReleaseChannel, ReleaseManifest, WebVersionCheck } from './web_version_check.js';
import { Result } from '../../utils/result.js';
import { AppHost, getAppHost } from '@akohn/dashql-react/dom/app_host';
import { ElectronVersionCheck } from './electron_version_check.js';

export enum VersionCheckStatusCode {
    Unknown = 0,
    Disabled = 1,
    UpToDate = 2,
    UpdateAvailable = 3,
    UpdateInstalling = 4,
    RestartPending = 5,
    UpdateFailed = 6,
}

export enum InstallationStatusCode {
    InProgress,
    RestartPending,
    Failed
}

export interface InstallationState {
    /// The channel of the installed update
    channel: ReleaseChannel;
    statusCode: InstallationStatusCode;
    totalBytes: number | null;
    loadedBytes: number;
    error: Error | null;
}

export interface InstallableUpdate {
    download(): Promise<void>
}

export interface VersionCheckRefresh {
    refresh: () => void;
    isRefreshing: boolean;
}

/// What the version check knows about a release channel
export interface ReleaseChannelState {
    /// The release manifest of the channel, null until it is fetched
    release: Result<ReleaseManifest> | null;
    /// The update that the app can install from the channel, null while unknown, a value of null if there is none
    update: Result<InstallableUpdate | null> | null;
}

/// The state of the version check
export interface VersionCheckState {
    status: VersionCheckStatusCode;
    /// Re-run the version check for all channels. Null when no check is available (unknown platform).
    refresh: VersionCheckRefresh | null;
    /// The installation of an update, null without one
    installation: InstallationState | null;
    stable: ReleaseChannelState;
    latest: ReleaseChannelState;
}

const UNKNOWN_VERSION_CHECK: VersionCheckState = {
    status: VersionCheckStatusCode.Unknown,
    refresh: null,
    installation: null,
    stable: { release: null, update: null },
    latest: { release: null, update: null },
};

const VERSION_CHECK_CTX = React.createContext<VersionCheckState>(UNKNOWN_VERSION_CHECK);
export const VersionCheckProvider = VERSION_CHECK_CTX.Provider;

export function useVersionCheckRefreshState(check: () => Promise<void>): VersionCheckRefresh {
    const pendingChecks = React.useRef(0);
    const [isRefreshing, setIsRefreshing] = React.useState(false);

    const refresh = React.useCallback(() => {
        pendingChecks.current += 1;
        setIsRefreshing(true);
        void check().finally(() => {
            pendingChecks.current -= 1;
            if (pendingChecks.current === 0) {
                setIsRefreshing(false);
            }
        });
    }, [check]);

    React.useEffect(() => {
        refresh();
    }, [refresh]);

    return React.useMemo(() => ({refresh, isRefreshing}), [refresh, isRefreshing]);
}

export const useVersionCheck = () => React.useContext(VERSION_CHECK_CTX);

interface VersionCheckProps {
    children: React.ReactElement;
}

export const VersionCheck: React.FC<VersionCheckProps> = (props: VersionCheckProps) => {
    return getAppHost() === AppHost.ELECTRON
        ? <ElectronVersionCheck>{props.children}</ElectronVersionCheck>
        : <WebVersionCheck>{props.children}</WebVersionCheck>;
};

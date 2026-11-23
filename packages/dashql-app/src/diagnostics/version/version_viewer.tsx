import * as React from 'react';
import symbols from '@akohn/dashql-svg-symbols';
import * as styles from './version_viewer.module.css';
import { InspectorHeader } from '@akohn/dashql-react/components/inspector_overlay';

import { SyncIcon, XIcon } from '@akohn/dashql-react/components/symbol_icon';

import { DASHQL_GIT_COMMIT, DASHQL_VERSION } from '../../globals.js';
import {
    InstallableUpdate,
    InstallationStatusCode,
    InstallationState,
    useVersionCheck,
    VersionCheckStatusCode,
} from '../../host/version/version_check.js';
import { Button, ButtonSize, ButtonVariant, IconButton } from '@akohn/dashql-react/components/button';
import { PlatformType, usePlatformType } from '../../host/platform_type.js';
import { canInstallReleaseVersion, detectReleaseChannel, ReleaseChannel, ReleaseManifest } from '../../host/version/web_version_check.js';
import { Result, RESULT_ERROR, RESULT_OK } from '../../utils/result.js';
import { IndicatorStatus, StatusIndicator } from '@akohn/dashql-react/components/status_indicator';
import { ReleaseBundles } from './release_bundle.js';
import { AnchoredOverlay } from '@akohn/dashql-react/components/anchored_overlay';
import { AnchorAlignment, AnchorSide } from '@akohn/dashql-react/dom/anchored_position';
import { ProgressBar } from '@akohn/dashql-react/components/progress_bar';
import { relaunch } from '../../host/process.js';
import { useLogger } from '../../host/logger_provider.js';
import { stringifyError } from '@akohn/dashql/platform/logger/logger';

export const VERSION_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const LOG_CTX = 'version_viewer';

interface UpdateChannelProps {
    channel: ReleaseChannel;
    name: string;
    /// Whether this is the channel the app currently tracks for updates
    isActive: boolean;
    releaseManifest: Result<ReleaseManifest | null> | null;
    updateManifest: Result<InstallableUpdate | null> | null;
    installationStatus: InstallationState | null;
    /// Install an update from this channel
    onInstall: (update: InstallableUpdate) => void;
}

const UpdateChannel: React.FC<UpdateChannelProps> = (props: UpdateChannelProps) => {
    let versionName: string | null = null;
    let status: React.ReactElement | null = null;

    // Get the newest version of the channel from the release manifest
    if (props.releaseManifest?.type === RESULT_OK) {
        if (props.releaseManifest.value != null) {
            versionName = props.releaseManifest.value.version;
        }
    }
    switch (props.updateManifest?.type) {
        case RESULT_OK:
            // Check if there's an installation status.
            // If there is no installation ongoing, we render a download button.
            // If the installation status refers to this channel, we render the installation status instead.
            // If it's not referring to this channel, we render nothing.
            if (props.installationStatus == null) {
                // Installs only move forward, also when switching channels. Moving from a latest build back
                // to an older stable would run it on storage the latest build already migrated.
                const isInstallable = versionName != null && canInstallReleaseVersion(versionName, DASHQL_VERSION);
                if (!isInstallable) {
                    status = props.isActive
                        ? <span className={styles.update_channel_action_status}>up to date</span>
                        : null;
                } else if (props.updateManifest.value != null) {
                    // The upgrade is installable, render a button to trigger installation.
                    const installable = props.updateManifest.value;
                    status = <Button size={ButtonSize.Small} onClick={() => props.onInstall(installable)}>Install</Button>;
                } else {
                    // The manifest advertises a newer version but no installable update was returned.
                    // update yet (e.g. the check is still in flight or failed). Surface it without an action.
                    status = <span className={styles.update_channel_action_status}>update available</span>;
                }
            } else {
                // Does the current installation refer to this channel?
                if (props.installationStatus.channel == props.channel) {
                    // Do we know the total bytes already?
                    // Render a query_status bar then.
                    if (props.installationStatus.totalBytes != null && props.installationStatus.totalBytes > 0) {
                        if (props.installationStatus.statusCode == InstallationStatusCode.InProgress) {
                            const progress = props.installationStatus.loadedBytes / props.installationStatus.totalBytes;
                            status = <ProgressBar className={styles.update_channel_action_progress} progress={progress * 100} />;
                        } else {
                            status = (
                                <StatusIndicator width="16px" height="16px" status={IndicatorStatus.Succeeded} />
                            );
                        }
                    } else {
                        // Otherwise just tell the user we're doing something
                        status = <span>installing</span>
                    }
                } else {
                    // Otherwise render nothing since we're installing a different update
                }
            }
            break;
        case RESULT_ERROR:
            status = <span>{(props.updateManifest.error as Error).message}</span>;
            break;
    }
    return (
        <>
            <div className={styles.update_channel_version}>
                <svg className={styles.update_channel_version_icon} width="16px" height="16px">
                    <use xlinkHref={`${symbols}#package`} />
                </svg>
                <div className={styles.update_channel_version_name}>
                    {versionName}
                </div>
            </div>
            <div className={styles.update_channel_name}>
                {props.name}
            </div>
            <div className={styles.update_channel_action}>
                {status ?? undefined}
            </div>
        </>
    );
}

interface VersionViewerProps {
    onClose: () => void;
    onRefresh: () => void;
}

export const VersionInfo: React.FC<VersionViewerProps> = (props: VersionViewerProps) => {
    const platformType = usePlatformType();
    const isWebPlatform = platformType == PlatformType.WEB;
    const { status, installation, stable, latest } = useVersionCheck();
    const logger = useLogger();
    const [relaunching, setRelaunching] = React.useState(false);

    // The channel the app currently tracks. It is fully dictated by the installed version scheme.
    const activeChannel: ReleaseChannel = detectReleaseChannel(DASHQL_VERSION);
    const activeUpdateManifest = activeChannel == "latest" ? latest.update : stable.update;

    // Are we on the most recent version of the active channel?
    // A successful update check that yields no update means we're up to date.
    let isUpToDate: boolean | null = null;
    if (activeUpdateManifest?.type === RESULT_OK) {
        isUpToDate = activeUpdateManifest.value == null;
    }

    // Install an update. The app restarts on the new version afterwards, so the channel re-derives itself.
    // A failed download shows as the toast of the error.
    const onInstall = React.useCallback((update: InstallableUpdate) => {
        update.download().catch((error: unknown) => {
            logger.error('Failed to download the update', { error: stringifyError(error) }, LOG_CTX);
        });
    }, [logger]);

    const onRelaunch = React.useCallback(() => {
        if (relaunching) {
            return;
        }
        setRelaunching(true);
        relaunch(logger).catch((error: unknown) => {
            setRelaunching(false);
            logger.error('Failed to relaunch the app', { error: stringifyError(error) }, LOG_CTX);
        });
    }, [logger, relaunching]);

    if (status == VersionCheckStatusCode.RestartPending) {
        return (
            <div className={styles.restart_overlay}>
                <InspectorHeader
                    title="Update ready"
                    titleClassName={styles.title}
                    actions={(
                        <>
                            <IconButton
                                variant={ButtonVariant.Invisible}
                                aria-label="Close"
                                onClick={props.onClose}
                            >
                                <XIcon />
                            </IconButton>
                        </>
                    )}
                />
                <div className={styles.restart_body}>
                    <div className={styles.restart_text}>
                        A new version has been installed. Relaunch to apply the update.
                    </div>
                    <Button
                        variant={ButtonVariant.Primary}
                        block
                        disabled={relaunching}
                        onClick={onRelaunch}
                    >
                        {relaunching ? 'Relaunching...' : 'Relaunch'}
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.overlay}>
            <InspectorHeader
                title="Version"
                titleClassName={styles.title}
                actions={(
                    <>
                        <VersionRefreshButton onRefresh={props.onRefresh} />
                        <IconButton
                            variant={ButtonVariant.Invisible}
                            aria-label="Close"
                            onClick={props.onClose}
                        >
                            <XIcon />
                        </IconButton>
                    </>
                )}
            />
            <div className={styles.version_info_container}>
                <div className={styles.version_info_key}>
                    Current Version
                </div>
                <div className={styles.version_info_value}>
                    <span>{DASHQL_VERSION}</span>
                    {!isWebPlatform && isUpToDate === true && (
                        <span className={styles.version_info_up_to_date}>up to date</span>
                    )}
                </div>
                <div className={styles.version_info_key}>
                    Channel
                </div>
                <div className={styles.version_info_value}>
                    {activeChannel}
                </div>
                <div className={styles.version_info_key}>
                    Git Commit
                </div>
                <div className={styles.version_info_value}>
                    {DASHQL_GIT_COMMIT}
                </div>
            </div>
            {!isWebPlatform && (
                <div className={styles.update_channels_container}>
                    <div className={styles.update_channels_title}>
                        Release Channels
                    </div>
                    <div className={styles.update_channel_list}>
                        <UpdateChannel
                            channel="stable"
                            name="stable"
                            isActive={activeChannel == "stable"}
                            releaseManifest={stable.release}
                            updateManifest={stable.update}
                            installationStatus={installation}
                            onInstall={onInstall}
                        />
                        <UpdateChannel
                            channel="latest"
                            name="latest"
                            isActive={activeChannel == "latest"}
                            releaseManifest={latest.release}
                            updateManifest={latest.update}
                            installationStatus={installation}
                            onInstall={onInstall}
                        />
                    </div>
                </div>
            )}
            {isWebPlatform && <ReleaseBundles className={styles.release_bundles} />}
        </div>
    );
}

type VersionInfoOverlayProps = {
    isOpen: boolean;
    onOpen?: () => void;
    onClose: () => void;
    renderAnchor: (p: object) => React.ReactElement;
    side?: AnchorSide;
    align?: AnchorAlignment;
    anchorOffset?: number;
}
export function VersionInfoOverlay(props: VersionInfoOverlayProps) {
    const refreshVersionCheck = useVersionCheck().refresh?.refresh ?? null;
    const lastOverlayCheckAt = React.useRef<number | null>(null);
    const refresh = React.useCallback(() => {
        lastOverlayCheckAt.current = Date.now();
        refreshVersionCheck?.();
    }, [refreshVersionCheck]);
    React.useEffect(() => {
        if (props.isOpen && refreshVersionCheck != null) {
            const now = Date.now();
            if (lastOverlayCheckAt.current != null && now - lastOverlayCheckAt.current < VERSION_CHECK_INTERVAL_MS) {
                return;
            }
            refresh();
        }
    }, [props.isOpen, refresh, refreshVersionCheck]);

    return (
        <AnchoredOverlay
            open={props.isOpen}
            onOpen={props.onOpen}
            onClose={props.onClose}
            renderAnchor={props.renderAnchor}
            side={props.side}
            align={props.align}
            anchorOffset={props.anchorOffset}
        >
            <VersionInfo onClose={props.onClose} onRefresh={refresh} />
        </AnchoredOverlay>
    );
}

function VersionRefreshButton(props: {onRefresh: () => void}) {
    const refreshVersionCheck = useVersionCheck().refresh;
    if (refreshVersionCheck == null) {
        return null;
    }
    return (
        <IconButton
            variant={ButtonVariant.Invisible}
            aria-label={refreshVersionCheck.isRefreshing ? 'Checking for updates' : 'Check for updates'}
            aria-disabled={refreshVersionCheck.isRefreshing}
            data-testid="version-check-refresh"
            onClick={() => {
                if (!refreshVersionCheck.isRefreshing) {
                    props.onRefresh();
                }
            }}
        >
            <span aria-hidden="true">
                {refreshVersionCheck.isRefreshing
                    ? <StatusIndicator width="16px" height="16px" fill="currentColor" status={IndicatorStatus.Running} />
                    : <SyncIcon />}
            </span>
        </IconButton>
    );
}

interface VersionCheckIndicatorProps {
    status: VersionCheckStatusCode;
    /// The size of the package icon in px, 16 by default, the badge of the status keeps its size
    size?: number;
}

/// The badge symbol of a status, null without a badge
function versionCheckBadge(status: VersionCheckStatusCode): string | null {
    switch (status) {
        case VersionCheckStatusCode.Unknown:
        case VersionCheckStatusCode.Disabled:
        case VersionCheckStatusCode.UpToDate:
            return null;
        case VersionCheckStatusCode.UpdateAvailable:
            return 'alert_fill_12';
        case VersionCheckStatusCode.UpdateInstalling:
            return 'refresh';
        case VersionCheckStatusCode.RestartPending:
            return 'rocket_circle_16';
        case VersionCheckStatusCode.UpdateFailed:
            return 'x_circle_16';
    }
}

export function VersionCheckIndicator(props: VersionCheckIndicatorProps) {
    const size = `${props.size ?? 16}px`;
    const badge = versionCheckBadge(props.status);
    return (
        <div className={badge == null ? styles.version_check_container : styles.version_check_container_with_indicator}>
            <div className={styles.version_check_icon}>
                <svg width={size} height={size}>
                    <use xlinkHref={`${symbols}#${badge == null ? 'package' : 'package_cut_24'}`} />
                </svg>
            </div>
            {badge != null && (
                <div className={styles.version_check_indicator}>
                    <svg width="10px" height="10px">
                        <use xlinkHref={`${symbols}#${badge}`} />
                    </svg>
                </div>
            )}
        </div>
    );
}

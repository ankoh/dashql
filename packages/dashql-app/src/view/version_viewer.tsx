import * as React from 'react';
import * as symbols from '../../static/svg/symbols.generated.svg';
import * as styles from './version_viewer.module.css';

import { XIcon } from '@primer/octicons-react';
import { ProgressBar } from '@primer/react';

import { DASHQL_GIT_COMMIT, DASHQL_VERSION } from '../globals.js';
import {
    InstallableUpdate,
    InstallationStatusCode,
    InstallationState,
    useCanaryReleaseManifest,
    useCanaryUpdateManifest,
    useInstallationStatus,
    useStableReleaseManifest,
    useStableUpdateManifest,
    useVersionCheck,
    VersionCheckStatusCode,
} from '../platform/version_check.js';
import { Button, ButtonVariant, IconButton } from './foundations/button.js';
import { PlatformType, usePlatformType } from '../platform/platform_type.js';
import { ReleaseManifest } from '../platform/web_version_check.js';
import { Result, RESULT_ERROR, RESULT_OK } from '../utils/result.js';
import { IndicatorStatus, StatusIndicator } from './foundations/status_indicator.js';
import { ReleaseBundles } from './release_bundle.js';
import { AnchoredOverlay } from './foundations/anchored_overlay.js';
import { AnchorAlignment, AnchorSide } from './foundations/anchored_position.js';
import { useProcess } from '../platform/process.js';

interface UpdateChannelProps {
    name: string;
    releaseManifest: Result<ReleaseManifest | null> | null;
    updateManifest: Result<InstallableUpdate | null> | null;
    installationStatus: InstallationState | null;
}

const UpdateChannel: React.FC<UpdateChannelProps> = (props: UpdateChannelProps) => {
    let versionName: string | null = null;
    let status: React.ReactElement | null = null;

    // Get the latest version from the release manifest
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
                // If the update manifest succeeded but is null, the released version cannot be installed
                if (props.updateManifest.value == null) {
                    status = <span>version incompatible</span>;
                } else {
                    // The version can be installed, render a button to trigger installation
                    const installable = props.updateManifest.value;
                    status = <Button onClick={async () => {
                        try {
                            await installable.download();
                        } catch (e: unknown) {
                            console.error(e);
                        }
                    }}>Install</Button>;
                }
            } else {
                // Does the current installation refer to this channel?
                if (props.installationStatus.update == props.updateManifest.value) {
                    console.log(props.installationStatus);
                    // Do we know the total bytes already?
                    // Render a query_status bar then.
                    if (props.installationStatus.totalBytes != null && props.installationStatus.totalBytes > 0) {
                        if (props.installationStatus.statusCode == InstallationStatusCode.InProgress) {
                            const progress = props.installationStatus.loadedBytes / props.installationStatus.totalBytes;
                            console.log(progress * 100);
                            status = <ProgressBar className={styles.update_channel_action_progress} progress={progress * 100} />;
                        } else {
                            status = (
                                <StatusIndicator width="16px" height="16px" fill="black" status={IndicatorStatus.Succeeded} />
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
}

export const VersionInfo: React.FC<VersionViewerProps> = (props: VersionViewerProps) => {
    const platformType = usePlatformType();
    const isWebPlatform = platformType == PlatformType.WEB;
    const stableReleaseManifest = useStableReleaseManifest();
    const stableUpdateManifest = useStableUpdateManifest();
    const canaryReleaseManifest = useCanaryReleaseManifest();
    const canaryUpdateManifest = useCanaryUpdateManifest();
    const installationStatus = useInstallationStatus();
    const versionCheck = useVersionCheck();
    const process = useProcess();

    if (versionCheck == VersionCheckStatusCode.RestartPending) {
        return (
            <div className={styles.overlay}>
                <Button onClick={() => process.relaunch()}>Relaunch</Button>
            </div>
        );
    }

    return (
        <div className={styles.overlay}>
            <div className={styles.header_container}>
                <div className={styles.header_left_container}>
                    <div className={styles.title}>Version</div>
                </div>
                <div className={styles.header_right_container}>
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        aria-label="Close"
                        onClick={props.onClose}
                    >
                        <XIcon />
                    </IconButton>
                </div>
            </div>
            <div className={styles.version_info_container}>
                <div className={styles.version_info_key}>
                    Current Version
                </div>
                <div className={styles.version_info_value}>
                    {DASHQL_VERSION}
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
                            name="stable"
                            releaseManifest={stableReleaseManifest}
                            updateManifest={stableUpdateManifest}
                            installationStatus={installationStatus}
                        />
                        <UpdateChannel
                            name="canary"
                            releaseManifest={canaryReleaseManifest}
                            updateManifest={canaryUpdateManifest}
                            installationStatus={installationStatus}
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
    onClose: () => void;
    renderAnchor: (p: object) => React.ReactElement;
    side?: AnchorSide;
    align?: AnchorAlignment;
    anchorOffset?: number;
}
export function VersionInfoOverlay(props: VersionInfoOverlayProps) {
    return (
        <AnchoredOverlay
            open={props.isOpen}
            onClose={props.onClose}
            renderAnchor={props.renderAnchor}
            side={props.side}
            align={props.align}
            anchorOffset={props.anchorOffset}
        >
            <VersionInfo onClose={props.onClose} />
        </AnchoredOverlay>
    );
}

interface VersionCheckIndicatorProps {
    status: VersionCheckStatusCode;
}

export function VersionCheckIndicator(props: VersionCheckIndicatorProps) {
    switch (props.status) {
        case VersionCheckStatusCode.Unknown:
        case VersionCheckStatusCode.Disabled:
        case VersionCheckStatusCode.UpToDate:
            return (
                <div className={styles.version_check_container}>
                    <div className={styles.version_check_icon}>
                        <svg width="16px" height="16px">
                            <use xlinkHref={`${symbols}#package`} />
                        </svg>
                    </div>
                </div>
            );
        case VersionCheckStatusCode.UpdateAvailable:
            return (
                <div className={styles.version_check_container_with_indicator}>
                    <div className={styles.version_check_icon}>
                        <svg width="16px" height="16px">
                            <use xlinkHref={`${symbols}#package_cut_24`} />
                        </svg>
                    </div>
                    <div className={styles.version_check_indicator}>
                        <svg width="10px" height="10px">
                            <use xlinkHref={`${symbols}#alert_fill_12`} />
                        </svg>
                    </div>
                </div>
            );
        case VersionCheckStatusCode.UpdateInstalling:
            return (
                <div className={styles.version_check_container_with_indicator}>
                    <div className={styles.version_check_icon}>
                        <svg width="16px" height="16px">
                            <use xlinkHref={`${symbols}#package_cut_24`} />
                        </svg>
                    </div>
                    <div className={styles.version_check_indicator}>
                        <svg width="10px" height="10px">
                            <use xlinkHref={`${symbols}#refresh`} />
                        </svg>
                    </div>
                </div>
            );
        case VersionCheckStatusCode.RestartPending:
            return (
                <div className={styles.version_check_container_with_indicator}>
                    <div className={styles.version_check_icon}>
                        <svg width="16px" height="16px">
                            <use xlinkHref={`${symbols}#package_cut_24`} />
                        </svg>
                    </div>
                    <div className={styles.version_check_indicator}>
                        <svg width="10px" height="10px">
                            <use xlinkHref={`${symbols}#rocket_circle_16`} />
                        </svg>
                    </div>
                </div>
            );
        case VersionCheckStatusCode.UpdateFailed:
            return (
                <div className={styles.version_check_container_with_indicator}>
                    <div className={styles.version_check_icon}>
                        <svg width="16px" height="16px">
                            <use xlinkHref={`${symbols}#package_cut_24`} />
                        </svg>
                    </div>
                    <div className={styles.version_check_indicator}>
                        <svg width="10px" height="10px">
                            <use xlinkHref={`${symbols}#x_circle_16`} />
                        </svg>
                    </div>
                </div>
            );
    }
}

import * as React from 'react';

import symbols from '@ankoh/dashql-svg-symbols';
import * as baseStyles from '../../ui/banner/banner_page.module.css';
import * as pageStyles from './app_loading_page.module.css';

import { AnchorAlignment, AnchorSide } from '../../ui/foundations/anchored_position.js';
import { AppLoadingStatus } from '../router/app_loading_status.js';
import { Button, ButtonVariant, IconButton } from '../../ui/foundations/button.js';
import { CONFIRM_FINISHED_SETUP, useRouteContext, useRouterNavigate } from '../router/router.js';
import { DASHQL_VERSION } from '../../globals.js';
import { getStatusFromProgressCounter, IndicatorStatus, StatusIndicator } from '../../ui/foundations/status_indicator.js';
import { InternalsViewerOverlay } from './internals/internals_overlay.js';
import { useComputeDatabase } from '../../compute/compute_connection_provider.js';
import { useDashQLCoreSetup } from '../providers/core_provider.js';
import { useStorageReader } from '../notebook/persistence/storage_provider.js';
import { AppLoadingProgress } from '../loading/app_loading_progress.js';

interface Props {
    pauseAfterSetup: boolean;
    progress: AppLoadingProgress;
}


export const AppLoadingPage: React.FC<Props> = (props: Props) => {
    const navigate = useRouterNavigate();
    const coreSetup = useDashQLCoreSetup();
    const computeDb = useComputeDatabase();
    const storageReader = useStorageReader();
    const routeContext = useRouteContext();

    // State to hide/show logs
    const [showInternals, setShowInternals] = React.useState<boolean>(false);
    // Compute the log button only once to prevent svg flickering
    const internalsButton = React.useMemo(() => {
        return (
            <IconButton
                variant={ButtonVariant.Invisible}
                aria-label="Show Internals"
                onClick={() => setShowInternals(s => !s)}
            >
                <svg width="16px" height="16px">
                    <use xlinkHref={`${symbols}#processor`} />
                </svg>
            </IconButton>
        );
    }, []);

    // Subscribe core setup.
    // Core setup does not have to run to completion, we're skipping past the loader before the wasm setup is done.
    const [coreStatus, setCoreStatus] = React.useState<IndicatorStatus>(IndicatorStatus.None);
    React.useEffect(() => {
        const abort = new AbortController();
        const run = async () => {
            try {
                setCoreStatus(IndicatorStatus.Running);
                await coreSetup("app_loader");
                if (!abort.signal.aborted) {
                    setCoreStatus(IndicatorStatus.Succeeded);
                }
            } catch (e: any) {
                setCoreStatus(IndicatorStatus.Failed);
            }
        };
        run();
        return () => abort.abort();
    }, []);

    const [computeStatus, setComputeStatus] = React.useState<IndicatorStatus>(IndicatorStatus.None);
    React.useEffect(() => {
        if (computeDb != null) {
            setComputeStatus(IndicatorStatus.Succeeded);
        } else {
            setComputeStatus(IndicatorStatus.Running);
        }
    }, [computeDb]);

    // Subscribe initial state restore
    const [storageStatus, setStorageStatus] = React.useState<IndicatorStatus>(IndicatorStatus.None);
    React.useEffect(() => {
        const abort = new AbortController();
        const run = async () => {
            try {
                setStorageStatus(IndicatorStatus.Running);
                await storageReader.waitForInitialRestore();
                if (!abort.signal.aborted) {
                    setStorageStatus(IndicatorStatus.Succeeded);
                }
            } catch (e: any) {
                setStorageStatus(IndicatorStatus.Failed);
            }
        };
        run();
        return () => abort.abort();
    }, []);

    // Show the continue button?
    const showContinueButton = props.pauseAfterSetup && routeContext.appLoadingStatus == AppLoadingStatus.SETUP_DONE;
    const confirmFinishedSetup = React.useCallback(() => {
        navigate({
            type: CONFIRM_FINISHED_SETUP,
            value: true
        });
    }, [navigate]);

    return (
        <div className={baseStyles.page} data-electron-drag-region>
            <div className={baseStyles.banner_and_content_container} data-electron-drag-region>
                <div className={baseStyles.banner_container} data-electron-drag-region>
                    <div className={baseStyles.banner_logo} data-electron-drag-region>
                        <svg width="100%" height="100%">
                            <use xlinkHref={`${symbols}#dashql`} />
                        </svg>
                    </div>
                    <div className={baseStyles.banner_text_container} data-electron-drag-region>
                        <div className={baseStyles.banner_title} data-electron-drag-region>dashql</div>
                        <div className={baseStyles.app_version} data-electron-drag-region>version {DASHQL_VERSION}</div>
                    </div>
                </div>
                <div className={baseStyles.content_container} data-electron-drag-region>
                    <div className={baseStyles.card}>
                        <div className={baseStyles.card_header} data-electron-drag-region>
                            <div className={baseStyles.card_header_left_container}>
                                <div className={baseStyles.card_header_left_title}>
                                    Setup
                                </div>
                            </div>
                            <div className={baseStyles.card_header_right_container}>
                                <InternalsViewerOverlay
                                    isOpen={showInternals}
                                    onClose={() => setShowInternals(false)}
                                    renderAnchor={(p: object) => <div {...p}>{internalsButton}</div>}
                                    side={AnchorSide.OutsideBottom}
                                    align={AnchorAlignment.End}
                                    anchorOffset={16}
                                />
                            </div>
                        </div>
                        <div className={baseStyles.card_section}>
                            <div className={baseStyles.section_entries}>
                                <div className={pageStyles.detail_entries}>
                                    <div className={pageStyles.detail_entry_key}>
                                        Initialize Core
                                    </div>
                                    <div className={pageStyles.detail_entry_value}>
                                        <StatusIndicator
                                            className={pageStyles.loading_status_indicator}
                                            fill="black"
                                            width={"14px"}
                                            height={"14px"}
                                            status={coreStatus}
                                        />
                                    </div>
                                    <div className={pageStyles.detail_entry_key}>
                                        Initialize HyperDB
                                    </div>
                                    <div className={pageStyles.detail_entry_value}>
                                        <StatusIndicator
                                            className={pageStyles.loading_status_indicator}
                                            fill="black"
                                            width={"14px"}
                                            height={"14px"}
                                            status={computeStatus}
                                        />
                                    </div>
                                    <div className={pageStyles.detail_entry_key}>
                                        Discover Notebooks
                                    </div>
                                    <div className={pageStyles.detail_entry_value}>
                                        <StatusIndicator
                                            className={pageStyles.loading_status_indicator}
                                            fill="black"
                                            width={"14px"}
                                            height={"14px"}
                                            status={getStatusFromProgressCounter(props.progress.restoreConnections)}
                                        />
                                    </div>
                                    <div className={pageStyles.detail_entry_key}>
                                        Load Notebook Scripts
                                    </div>
                                    <div className={pageStyles.detail_entry_value}>
                                        <StatusIndicator
                                            className={pageStyles.loading_status_indicator}
                                            fill="black"
                                            width={"14px"}
                                            height={"14px"}
                                            status={getStatusFromProgressCounter(props.progress.restoreNotebookScripts)}
                                        />
                                    </div>
                                </div>
                            </div>
                            {props.pauseAfterSetup && (
                                <div className={baseStyles.card_actions}>
                                    <div className={baseStyles.card_actions_right}>
                                        <Button
                                            variant={ButtonVariant.Primary}
                                            disabled={!showContinueButton}
                                            onClick={confirmFinishedSetup}
                                        >
                                            Continue
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

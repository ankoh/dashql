import * as React from 'react';

import * as symbols from '../../static/svg/symbols.generated.svg';
import * as baseStyles from './banner_page.module.css';
import * as pageStyles from './app_loading_page.module.css';

import { AnchorAlignment, AnchorSide } from './foundations/anchored_position.js';
import { AppLoadingStatus } from '../app_loading_status.js';
import { Button, ButtonVariant, IconButton } from './foundations/button.js';
import { CONFIRM_FINISHED_SETUP, useRouteContext, useRouterNavigate } from '../router.js';
import { DASHQL_VERSION } from '../globals.js';
import { IndicatorStatus, StatusIndicator } from './foundations/status_indicator.js';
import { InternalsViewerOverlay } from './internals/internals_overlay.js';
import { useDashQLComputeWorker } from '../compute/compute_provider.js';
import { useDashQLCoreSetup } from '../core_provider.js';
import { useStorageReader } from '../storage/storage_provider.js';

const LOG_CTX = "app_loading";

interface Props {
    pauseAfterSetup: boolean;
}


export const AppLoadingPage: React.FC<Props> = (props: Props) => {
    const navigate = useRouterNavigate();
    const coreSetup = useDashQLCoreSetup();
    const computeSetup = useDashQLComputeWorker();
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

    // Subscribe compute setup.
    // Similar to core, compute does not have to run to completion.
    // We're skipping past the loader before the compute setup is done.
    const [computeStatus, setComputeStatus] = React.useState<IndicatorStatus>(IndicatorStatus.None);
    React.useEffect(() => {
        const abort = new AbortController();
        const run = async () => {
            try {
                setComputeStatus(IndicatorStatus.Running);
                await computeSetup.waitForInstantiation();
                if (!abort.signal.aborted) {
                    setComputeStatus(IndicatorStatus.Succeeded);
                }
            } catch (e: any) {
                setComputeStatus(IndicatorStatus.Failed);
            }
        };
        run();
        return () => abort.abort();
    }, []);

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

    // 
    const [connectionStatus, setConnectionStatus] = React.useState<IndicatorStatus>(IndicatorStatus.None);

    const [catalogStatus, setCatalogStatus] = React.useState<IndicatorStatus>(IndicatorStatus.None);

    const [workbookStatus, setWorkbookStatus] = React.useState<IndicatorStatus>(IndicatorStatus.None);

    // Show the continue button?
    const showContinueButton = props.pauseAfterSetup && routeContext.appLoadingStatus == AppLoadingStatus.SETUP_DONE;
    const confirmFinishedSetup = React.useCallback(() => {
        navigate({
            type: CONFIRM_FINISHED_SETUP,
            value: true
        });
    }, [navigate]);

    return (
        <div className={baseStyles.page} data-tauri-drag-region>
            <div className={baseStyles.banner_and_content_container} data-tauri-drag-region>
                <div className={baseStyles.banner_container} data-tauri-drag-region>
                    <div className={baseStyles.banner_logo} data-tauri-drag-region>
                        <svg width="100%" height="100%">
                            <use xlinkHref={`${symbols}#dashql`} />
                        </svg>
                    </div>
                    <div className={baseStyles.banner_text_container} data-tauri-drag-region>
                        <div className={baseStyles.banner_title} data-tauri-drag-region>dashql</div>
                        <div className={baseStyles.app_version} data-tauri-drag-region>version {DASHQL_VERSION}</div>
                    </div>
                </div>
                <div className={baseStyles.content_container} data-tauri-drag-region>
                    <div className={baseStyles.card}>
                        <div className={baseStyles.card_header} data-tauri-drag-region>
                            <div className={baseStyles.card_header_left_container}>
                                Setup
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
                                        Instantiate Core
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
                                        Instantiate Compute Worker
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
                                        Load Connections
                                    </div>
                                    <div className={pageStyles.detail_entry_value}>
                                        <StatusIndicator
                                            className={pageStyles.loading_status_indicator}
                                            fill="black"
                                            width={"14px"}
                                            height={"14px"}
                                            status={connectionStatus}
                                        />
                                    </div>
                                    <div className={pageStyles.detail_entry_key}>
                                        Load Catalogs
                                    </div>
                                    <div className={pageStyles.detail_entry_value}>
                                        <StatusIndicator
                                            className={pageStyles.loading_status_indicator}
                                            fill="black"
                                            width={"14px"}
                                            height={"14px"}
                                            status={catalogStatus}
                                        />
                                    </div>
                                    <div className={pageStyles.detail_entry_key}>
                                        Load Workbooks
                                    </div>
                                    <div className={pageStyles.detail_entry_value}>
                                        <StatusIndicator
                                            className={pageStyles.loading_status_indicator}
                                            fill="black"
                                            width={"14px"}
                                            height={"14px"}
                                            status={workbookStatus}
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

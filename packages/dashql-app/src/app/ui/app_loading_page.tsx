import * as React from 'react';

import * as baseStyles from '../../ui/banner/banner_page.module.css';

import { AppLoadingStatus } from '../loading/app_loading_status.js';
import { Button, ButtonVariant } from '../../ui/foundations/button.js';
import { CONFIRM_FINISHED_SETUP, useRouteContext, useRouterNavigate } from '../router/router.js';
import { getStatusFromProgressCounter, IndicatorStatus } from '../../ui/foundations/status_indicator.js';
import { useDashQLCoreSetup } from '../providers/core_provider.js';
import { AppLoadingProgress } from '../loading/app_loading_progress.js';
import { useStorageMigrationStatus } from '../storage/storage_provider.js';
import { AppSetupPage } from './app_setup_page.js';

interface Props {
    pauseAfterSetup: boolean;
    progress: AppLoadingProgress;
    embeddedDatabaseStatus: IndicatorStatus;
}

export const AppLoadingPage: React.FC<Props> = (props: Props) => {
    const navigate = useRouterNavigate();
    const coreSetup = useDashQLCoreSetup();
    const routeContext = useRouteContext();
    const migrationStatus = useStorageMigrationStatus();

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

    // Show the continue button?
    const showContinueButton = props.pauseAfterSetup && routeContext.appLoadingStatus == AppLoadingStatus.SETUP_DONE;
    const confirmFinishedSetup = React.useCallback(() => {
        navigate({
            type: CONFIRM_FINISHED_SETUP,
            value: true
        });
    }, [navigate]);

    return (
        <AppSetupPage
            status={{
                applyMigrations: migrationStatus,
                initializeCore: coreStatus,
                initializeHyperDB: props.embeddedDatabaseStatus,
                discoverSessions: getStatusFromProgressCounter(props.progress.restoreConnections),
                loadSessionScripts: getStatusFromProgressCounter(props.progress.restoreSessionScripts),
            }}
            actions={props.pauseAfterSetup && (
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
        />
    );
};

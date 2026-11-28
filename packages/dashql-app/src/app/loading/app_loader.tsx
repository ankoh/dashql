import * as React from 'react';

import { useRouteContext, useSelectOpeningWorkbook } from '../router.js';
import { AppLoadingPage } from '../app_loading_page.js';
import { canShowWorkbook } from './app_loading_logic.js';
import { useAppConfig, useAppConfigError, useAppReconfigure } from '../../config/app_config.js';
import { useAppSettingsReady } from '../../config/app_settings_sync.js';
import { useOptionalRuntime, useWorkbook } from '@akohn/dashql-react/hooks';
import { useHyperLinkTabState } from '../../connections/hyper/hyper_link.js';
import { NarrowScreenWarning, useNarrowScreenWarning } from '../narrow_screen_warning.js';
import { AppSetupConfirmationProvider, isAppStateRestored, useAppSetup } from './app_setup.js';
import { useSharedWorkbookImport } from './shared_workbook_import.js';
import { isCloudLink, useCloudSetupGate } from './cloud_setup_gate.js';
import { useHyperLinks } from '../hyper_links.js';

export const AppLoader: React.FC<React.PropsWithChildren> = (props: React.PropsWithChildren) => {
    const config = useAppConfig();
    const configError = useAppConfigError();
    const appSettingsReady = useAppSettingsReady();
    const reconfigure = useAppReconfigure();
    const showNarrowScreenWarning = useNarrowScreenWarning(appSettingsReady, config?.settings?.narrowScreenLayout ?? false);
    const routeContext = useRouteContext();
    const runtime = useOptionalRuntime();
    // The runtime sets up the connections of the opened workbook that need nothing of the user: the embedded Hyper, and
    // the Hyper of a link once the tab holds its token. It considers every connection once (`open_setup` of the runtime
    // crate), once the config is loaded.
    const configLoaded = config != null;
    const openedWorkbook = useWorkbook(routeContext.workbookId ?? null);
    const openedWorkbookId = openedWorkbook?.workbookId ?? null;
    const openedConnections = openedWorkbook?.connectionIds.join(' ') ?? null;
    const hyperLinks = useHyperLinkTabState();
    React.useEffect(() => {
        if (runtime == null || !configLoaded || openedWorkbookId == null) return;
        runtime.setUpOpenedWorkbook(openedWorkbookId);
    }, [runtime, configLoaded, openedWorkbookId, openedConnections, hyperLinks]);

    // The import of a workbook that the app was started with, the setup then doesn't open another one
    const initialImport = React.useRef<Promise<boolean> | null>(null);
    const setup = useAppSetup(initialImport);
    const restored = isAppStateRestored(setup.phase);
    const opened = setup.phase === 'opened';
    const sharedWorkbookCard = useSharedWorkbookImport(restored, opened, initialImport);
    // The document query, HashRouter keeps it out of its location
    const [cloudLink] = React.useState(() => isCloudLink(globalThis.location.search));
    const cloudSetupPage = useCloudSetupGate(restored, cloudLink);
    useHyperLinks(opened);
    // Did the user confirm the finished setup? An app that pauses after its setup waits for it.
    const [confirmed, setConfirmed] = React.useState(false);
    const confirmFinishedSetup = React.useCallback(() => setConfirmed(true), []);

    useSelectOpeningWorkbook();

    if (showNarrowScreenWarning) {
        return <NarrowScreenWarning onEnable={() => reconfigure(value => value == null ? null : {
            ...value,
            settings: { ...value.settings, narrowScreenLayout: true },
        })} />;
    }
    if (sharedWorkbookCard != null) {
        return sharedWorkbookCard;
    }

    // Setup done and workbook selected? Show main interface
    const pauseAfterSetup = config?.settings?.pauseAfterAppSetup ?? false;
    if (canShowWorkbook({ phase: setup.phase, confirmed, pauseAfterSetup }, routeContext.workbookId)) {
        // The cloud setup shows before the workbench, at the start of the app with a cloud link and when the app asks for it
        return (
            <AppSetupConfirmationProvider value={setConfirmed}>
                {cloudSetupPage ?? props.children}
            </AppSetupConfirmationProvider>
        );
    } else {
        // Otherwise show the app loading page
        return <AppLoadingPage
            pauseAfterSetup={pauseAfterSetup}
            progress={setup.progress}
            embeddedDatabaseStatus={setup.embeddedDatabaseStatus}
            error={configError ?? setup.error}
            onContinue={opened ? confirmFinishedSetup : undefined}
        />;
    }
};

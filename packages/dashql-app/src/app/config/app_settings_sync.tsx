import * as React from 'react';

import { useAppConfig, useAppReconfigure } from './app_config.js';
import { useStorageReader } from '../notebook/persistence/storage_provider.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { AppLoadingStatus } from '../router/app_loading_status.js';
import { useRouteContext } from '../router/router.js';

const LOG_CTX = 'app_settings_sync';

type Props = {
    children: React.ReactElement;
};

const APP_SETTINGS_READY_CTX = React.createContext(false);

export const useAppSettingsReady = (): boolean => React.useContext(APP_SETTINGS_READY_CTX);

/// Hydrates AppConfig.settings from the persisted manifest once StorageProvider
/// is ready, and persists subsequent changes back to the manifest.
export const AppSettingsSync: React.FC<Props> = (props: Props) => {
    const config = useAppConfig();
    const reconfigure = useAppReconfigure();
    const storageReader = useStorageReader();
    const logger = useLogger();
    const route = useRouteContext();

    const [hydrated, setHydrated] = React.useState(false);
    const hydrating = React.useRef(false);

    React.useEffect(() => {
        if (hydrating.current) return;
        if (config == null) return;
        hydrating.current = true;
        storageReader.backend.loadAppSettings().then(stored => {
            if (stored != null) {
                logger.info("Hydrated app settings from manifest", {}, LOG_CTX);
                reconfigure(c => c == null ? null : {
                    ...c,
                    settings: { ...(c.settings ?? {}), ...stored },
                });
            }
        }).catch(e => {
            logger.warn("Failed to load app settings from manifest", { error: String(e) }, LOG_CTX);
        }).finally(() => {
            setHydrated(true);
        });
    }, [config, storageReader, reconfigure, logger]);

    React.useEffect(() => {
        if (!hydrated) return;
        if (config?.settings == null) return;
        const settings = config.settings;
        const handle = setTimeout(() => {
            storageReader.backend.saveAppSettings(settings).catch(e => {
                logger.warn("Failed to persist app settings", { error: String(e) }, LOG_CTX);
            });
        }, 250);
        return () => clearTimeout(handle);
    }, [hydrated, config?.settings, storageReader, logger]);

    React.useEffect(() => {
        if (!hydrated || route.appLoadingStatus !== AppLoadingStatus.SETUP_DONE || route.notebookId == null) return;
        if (config?.settings?.lastOpenedNotebookId === route.notebookId) return;
        const notebookId = route.notebookId;
        reconfigure(current => current == null ? null : {
            ...current,
            settings: {
                ...(current.settings ?? {}),
                lastOpenedNotebookId: notebookId,
            },
        });
    }, [config?.settings?.lastOpenedNotebookId, hydrated, reconfigure, route.appLoadingStatus, route.notebookId]);

    return <APP_SETTINGS_READY_CTX.Provider value={hydrated}>{props.children}</APP_SETTINGS_READY_CTX.Provider>;
};

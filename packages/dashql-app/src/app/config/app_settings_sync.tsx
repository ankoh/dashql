import * as React from 'react';

import { useAppConfig, useAppReconfigure } from './app_config.js';
import { useStorageReader } from '../storage/storage_provider.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { useAppFlavorSelect } from '../flavor/flavor_provider.js';

const LOG_CTX = 'app_settings_sync';

type Props = {
    children: React.ReactElement;
};

const APP_SETTINGS_READY_CTX = React.createContext(false);

export const useAppSettingsReady = (): boolean => React.useContext(APP_SETTINGS_READY_CTX);

/// Hydrates AppConfig.settings from the persisted manifest once StorageProvider
/// is ready, and persists subsequent changes back to the manifest.
/// Selects the flavor of the settings, a flavor requested by the url still wins.
export const AppSettingsSync: React.FC<Props> = (props: Props) => {
    const config = useAppConfig();
    const reconfigure = useAppReconfigure();
    const storageReader = useStorageReader();
    const logger = useLogger();
    const selectFlavor = useAppFlavorSelect();

    const [hydrated, setHydrated] = React.useState(false);
    const hydrating = React.useRef(false);

    React.useEffect(() => {
        if (hydrating.current) return;
        if (config == null) return;
        hydrating.current = true;
        storageReader.backend.loadAppSettings().then(stored => {
            if (stored != null) {
                logger.info("Hydrated app settings from manifest", {}, LOG_CTX);
                const { lastOpenedSessionId: _lastOpenedSessionId, ...settings } = stored as typeof stored & {
                    lastOpenedSessionId?: string;
                };
                reconfigure(c => c == null ? null : {
                    ...c,
                    settings: { ...(c.settings ?? {}), ...settings },
                });
                // Select the flavor in the same render as the hydration, the app setup loads the fonts of the flavor
                selectFlavor(settings.flavor ?? config.settings?.flavor);
            }
        }).catch(e => {
            logger.warn("Failed to load app settings from manifest", { error: String(e) }, LOG_CTX);
        }).finally(() => {
            setHydrated(true);
        });
    }, [config, storageReader, reconfigure, selectFlavor, logger]);

    // Select the flavor when the settings change it
    const flavorId = config?.settings?.flavor;
    React.useLayoutEffect(() => {
        selectFlavor(flavorId);
    }, [flavorId, selectFlavor]);

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

    return <APP_SETTINGS_READY_CTX.Provider value={hydrated}>{props.children}</APP_SETTINGS_READY_CTX.Provider>;
};

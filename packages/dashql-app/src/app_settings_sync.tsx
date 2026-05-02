import * as React from 'react';

import { useAppConfig, useAppReconfigure } from './app_config.js';
import { useStorageReader } from './platform/storage/storage_provider.js';
import { useHttpProxyConfig } from './platform/http/http_client_provider.js';
import { useLogger } from './platform/logger/logger_provider.js';

const LOG_CTX = 'app_settings_sync';

type Props = {
    children: React.ReactElement;
};

/// Hydrates AppConfig.settings from the persisted manifest once StorageProvider
/// is ready, and mirrors proxy-related settings into the shared HttpProxyConfigHolder
/// so the singleton HttpClient reflects the latest values without being recreated.
export const AppSettingsSync: React.FC<Props> = (props: Props) => {
    const config = useAppConfig();
    const reconfigure = useAppReconfigure();
    const storageReader = useStorageReader();
    const proxyConfig = useHttpProxyConfig();
    const logger = useLogger();

    const hydrated = React.useRef(false);
    React.useEffect(() => {
        if (hydrated.current) return;
        if (config == null) return;
        hydrated.current = true;
        storageReader.backend.loadAppSettings().then(stored => {
            if (stored == null) return;
            logger.info("Hydrated app settings from manifest", {}, LOG_CTX);
            reconfigure(c => c == null ? null : {
                ...c,
                settings: { ...(c.settings ?? {}), ...stored },
            });
        }).catch(e => {
            logger.warn("Failed to load app settings from manifest", { error: String(e) }, LOG_CTX);
        });
    }, [config, storageReader, reconfigure, logger]);

    React.useEffect(() => {
        proxyConfig.set({
            proxyUrl: config?.settings?.httpProxyUrl,
            targetList: config?.settings?.httpProxyTargetList,
        });
    }, [proxyConfig, config?.settings?.httpProxyUrl, config?.settings?.httpProxyTargetList]);

    return props.children;
};

import * as React from 'react';
import * as styles from './app_settings_view.module.css';

import { XIcon } from '@primer/octicons-react';
import { Button, ButtonVariant, IconButton } from '../view/foundations/button.js';

import { AppConfig, useAppConfig, useAppReconfigure } from '../app_config.js';
import { useWorkbookRegistry } from '../workbook/workbook_state_registry.js';
import { useConnectionRegistry } from '../connection/connection_registry.js';
import { useDashQLCoreSetup } from '../core_provider.js';
import { checkMemoryLiveness } from '../utils/memory_liveness.js';

export function AppSettings(props: { onClose: () => void; }) {
    const config = useAppConfig();
    const reconfigure = useAppReconfigure();

    const coreSetup = useDashQLCoreSetup();
    const [connectionRegistry, _modifyConnections] = useConnectionRegistry();
    const [workbookRegistry, _modifyWorkbooks] = useWorkbookRegistry();

    const toggleDebugMode = React.useCallback(() => {
        reconfigure((value: AppConfig | null) => (value == null ? null : {
            ...value,
            settings: {
                ...value.settings,
                interfaceDebugMode: !value.settings?.interfaceDebugMode,
            }
        }));
        props.onClose();
    }, []);
    const checkMemory = React.useCallback(async () => {
        const core = await coreSetup("app_settings");
        const _mem = checkMemoryLiveness(core, connectionRegistry, workbookRegistry);

    }, []);

    const interfaceDebugMode = config?.settings?.interfaceDebugMode ?? false;
    return (
        <div className={styles.settings_root}>
            <div className={styles.header_container}>
                <div className={styles.header_left_container}>
                    <div className={styles.title}>App Settings</div>
                </div>
                <div className={styles.header_right_container}>
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        aria-label="close-overlay"
                        onClick={props.onClose}
                    >
                        <XIcon />
                    </IconButton>
                </div>
            </div>
            <div className={styles.internals_container}>
                <div className={styles.settings_container}>
                    <div className={styles.setting_name}>
                        Interface Debug Mode
                    </div>
                    <div className={styles.setting_switch}>
                        <Button onClick={toggleDebugMode}>
                            {interfaceDebugMode ? "Disable" : "Enable"}
                        </Button>
                    </div>
                    <div className={styles.setting_name}>
                        Check Memory Leaks
                    </div>
                    <div className={styles.setting_switch}>
                        <Button onClick={checkMemory}>
                            Run
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}

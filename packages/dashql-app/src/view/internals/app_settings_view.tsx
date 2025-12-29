import * as React from 'react';
import * as styles from './app_settings_view.module.css';

import { XIcon } from '@primer/octicons-react';
import { Button, ButtonVariant, IconButton } from '../../view/foundations/button.js';

import { AppLoadingStatus } from '../../app_loading_status.js';
import { CONFIRM_FINISHED_SETUP, useRouteContext, useRouterNavigate } from '../../router.js';
import { checkMemoryLiveness } from '../../utils/memory_liveness.js';
import { useConnectionRegistry } from '../../connection/connection_registry.js';
import { useDashQLCoreSetup } from '../../core_provider.js';
import { useWorkbookRegistry } from '../../workbook/workbook_state_registry.js';

export function AppSettings(props: { onClose: () => void; }) {
    // const config = useAppConfig();
    // const reconfigure = useAppReconfigure();
    const routerNavigate = useRouterNavigate();
    const routerContext = useRouteContext();

    const coreSetup = useDashQLCoreSetup();
    const [connectionRegistry, _modifyConnections] = useConnectionRegistry();
    const [workbookRegistry, _modifyWorkbooks] = useWorkbookRegistry();

    // const toggleInterfaceDebugging = React.useCallback(() => {
    //     reconfigure((value: AppConfig | null) => (value == null ? null : {
    //         ...value,
    //         settings: {
    //             ...value.settings,
    //             interfaceDebugMode: !value.settings?.interfaceDebugMode,
    //         }
    //     }));
    //     props.onClose();
    // }, []);
    const checkMemory = React.useCallback(async () => {
        const core = await coreSetup("app_settings");
        checkMemoryLiveness(core, connectionRegistry, workbookRegistry);
    }, []);
    const revertSetupConfirmation = React.useCallback(() => {
        routerNavigate({
            type: CONFIRM_FINISHED_SETUP,
            value: false
        })
    }, [routerNavigate]);

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
                        Check Memory Leaks
                    </div>
                    <div className={styles.setting_switch}>
                        <Button onClick={checkMemory}>
                            Run
                        </Button>
                    </div>
                    <div className={styles.setting_name}>
                        Revert Setup Confirmation
                    </div>
                    <div className={styles.setting_switch}>
                        <Button
                            onClick={revertSetupConfirmation}
                            disabled={routerContext.appLoadingStatus != AppLoadingStatus.SETUP_DONE}
                        >
                            Run
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}

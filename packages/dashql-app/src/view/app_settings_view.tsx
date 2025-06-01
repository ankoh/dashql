import * as React from 'react';
import * as styles from './app_settings_view.module.css';

import { XIcon } from '@primer/octicons-react';
import { Button, ButtonVariant, IconButton } from '../view/foundations/button.js';

import { AppConfig, useAppConfig, useAppReconfigure } from '../app_config.js';

export function AppSettings(props: { onClose: () => void; }) {
    const config = useAppConfig();
    const reconfigure = useAppReconfigure();
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
                </div>
            </div>
        </div>
    );
}

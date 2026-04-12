import * as React from 'react';
import * as styles from './app_settings_view.module.css';

import { XIcon } from '@primer/octicons-react';
import { Button, ButtonVariant, IconButton } from '../../view/foundations/button.js';
import { ToggleSwitch } from '../../view/foundations/toggle_switch.js';
import { SegmentedControl } from '../../view/foundations/segmented_control.js';

import { AppConfig, useAppConfig, useAppReconfigure } from '../../app_config.js';
import { AppLoadingStatus } from '../../app_loading_status.js';
import { CONFIRM_FINISHED_SETUP, useRouteContext, useRouterNavigate } from '../../router.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { LogLevel } from '../../platform/logger/log_buffer.js';

export function AppSettings(props: { onClose: () => void; }) {
    const config = useAppConfig();
    const reconfigure = useAppReconfigure();
    const routerNavigate = useRouterNavigate();
    const routerContext = useRouteContext();
    const logger = useLogger();

    const toggleTableDebugMode = React.useCallback(() => {
        reconfigure((value: AppConfig | null) => (value == null ? null : {
            ...value,
            settings: {
                ...(value.settings ?? {}),
                tableDebugMode: !value.settings?.tableDebugMode,
            }
        }));
    }, [reconfigure]);
    const toggleFormattingDebugMode = React.useCallback(() => {
        reconfigure((value: AppConfig | null) => (value == null ? null : {
            ...value,
            settings: {
                ...(value.settings ?? {}),
                formattingDebugMode: !value.settings?.formattingDebugMode,
            }
        }));
    }, [reconfigure]);
    const revertSetupConfirmation = React.useCallback(() => {
        // Enable pause after setup, then reload
        reconfigure((value: AppConfig | null) => (value == null ? null : {
            ...value,
            settings: {
                ...(value.settings ?? {}),
                pauseAfterAppSetup: true,
            }
        }));
        routerNavigate({
            type: CONFIRM_FINISHED_SETUP,
            value: false,
        });
    }, [reconfigure]);

    const minLogLevel = config?.settings?.minLogLevel ?? LogLevel.Info;
    const setMinLogLevel = React.useCallback((level: LogLevel) => {
        reconfigure((value: AppConfig | null) => (value == null ? null : {
            ...value,
            settings: {
                ...(value.settings ?? {}),
                minLogLevel: level,
            }
        }));
        logger.buffer.setMinLogLevel(level);
    }, [reconfigure, logger]);

    // Apply log level from config on mount
    React.useEffect(() => {
        logger.buffer.setMinLogLevel(minLogLevel);
    }, [minLogLevel, logger]);

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
                    <div id="app-setting-min-log-level" className={styles.setting_name}>
                        Minimum Log Level
                    </div>
                    <div className={styles.setting_switch}>
                        <SegmentedControl
                            aria-labelledby="app-setting-min-log-level"
                            onChange={(index) => {
                                const levels = [LogLevel.Trace, LogLevel.Debug, LogLevel.Info, LogLevel.Warn, LogLevel.Error];
                                setMinLogLevel(levels[index]);
                            }}
                        >
                            <SegmentedControl.Button selected={minLogLevel === LogLevel.Trace}>
                                Trace
                            </SegmentedControl.Button>
                            <SegmentedControl.Button selected={minLogLevel === LogLevel.Debug}>
                                Debug
                            </SegmentedControl.Button>
                            <SegmentedControl.Button selected={minLogLevel === LogLevel.Info}>
                                Info
                            </SegmentedControl.Button>
                            <SegmentedControl.Button selected={minLogLevel === LogLevel.Warn}>
                                Warn
                            </SegmentedControl.Button>
                            <SegmentedControl.Button selected={minLogLevel === LogLevel.Error}>
                                Error
                            </SegmentedControl.Button>
                        </SegmentedControl>
                    </div>
                    <div className={styles.setting_name}>
                        Revert Setup Confirmation
                    </div>
                    <div className={styles.setting_switch}>
                        <Button onClick={revertSetupConfirmation}>
                            Restart
                        </Button>
                    </div>
                    <div id="app-setting-table-debug-mode" className={styles.setting_name}>
                        Table Debug Mode
                    </div>
                    <div className={styles.setting_switch}>
                        <ToggleSwitch
                            size="medium"
                            checked={config?.settings?.tableDebugMode ?? false}
                            onClick={toggleTableDebugMode}
                            disabled={config == null}
                            aria-labelledby="app-setting-table-debug-mode"
                        />
                    </div>
                    <div id="app-setting-formatting-debug-mode" className={styles.setting_name}>
                        Formatting Debug Mode
                    </div>
                    <div className={styles.setting_switch}>
                        <ToggleSwitch
                            size="medium"
                            checked={config?.settings?.formattingDebugMode ?? false}
                            onClick={toggleFormattingDebugMode}
                            disabled={config == null}
                            aria-labelledby="app-setting-formatting-debug-mode"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}

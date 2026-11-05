import * as React from 'react';
import * as styles from './app_settings_view.module.css';

import { XIcon } from '../../ui/foundations/symbol_icon.js';
import { Button, ButtonVariant, IconButton } from '../../ui/foundations/button.js';
import { ToggleSwitch } from '../../ui/foundations/toggle_switch.js';
import { SegmentedControl } from '../../ui/foundations/segmented_control.js';

import { AppConfig, AppSettings as AppSettingsValue, useAppConfig, useAppReconfigure } from '../../config/app_config.js';
import { CONFIRM_FINISHED_SETUP, useRouteContext, useRouterNavigate } from '../router/router.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { LogLevel } from '../../platform/logger/log_buffer.js';
import { useStorageReader } from '../../storage/storage_provider.js';
import { useQueryResultCache } from '../../storage/query_result_cache_provider.js';
import { AppFlavor, FLAVORS } from '../../config/flavors.js';
import { useAppFlavor, useRequestedAppFlavor } from '../../config/flavor_provider.js';
import { useAppRestart } from '../../platform/crosstab/app_hand_over.js';

/// The boolean settings that the panel toggles directly
type ToggleSettingKey =
    | 'agentFace'
    | 'narrowScreenLayout'
    | 'macWindowLayout'
    | 'scriptDebugMode'
    | 'tableDebugMode'
    | 'formattingDebugMode'
    | 'forceReLogin'
    | 'experimental_file_attachments';

const LOG_LEVELS = [
    { level: LogLevel.Trace, label: 'Trace' },
    { level: LogLevel.Debug, label: 'Debug' },
    { level: LogLevel.Info, label: 'Info' },
    { level: LogLevel.Warn, label: 'Warn' },
    { level: LogLevel.Error, label: 'Error' },
];

function SettingsSection(props: { title: string; hideTitle?: boolean; children: React.ReactNode; }) {
    return (
        <section className={styles.settings_section} aria-label={props.title}>
            {!props.hideTitle && <h3 className={styles.section_title}>{props.title}</h3>}
            <div className={styles.settings_container}>
                {props.children}
            </div>
        </section>
    );
}

export function AppSettings(props: { onClose: () => void; }) {
    const config = useAppConfig();
    const reconfigure = useAppReconfigure();
    const routerNavigate = useRouterNavigate();
    const routerContext = useRouteContext();
    const logger = useLogger();
    const storageReader = useStorageReader();
    const queryResultCache = useQueryResultCache();
    const restartApp = useAppRestart();

    const [isClearing, setIsClearing] = React.useState(false);
    const [isRestarting, setIsRestarting] = React.useState(false);

    /// Toggle a setting, an unset setting has its default
    const toggleSetting = React.useCallback((key: ToggleSettingKey, defaultValue: boolean) => {
        reconfigure((value: AppConfig | null) => (value == null ? null : {
            ...value,
            settings: { ...(value.settings ?? {}), [key]: !(value.settings?.[key] ?? defaultValue) },
        }));
    }, [reconfigure]);
    // The embedded database reads the backend when it starts, the app restarts to apply it.
    // The restart stops the writers like a hand over to another tab: the database cancels its running queries,
    // e.g. of the log monitors, and drops the computed tables.
    const toggleExperimentalWasmBackend = React.useCallback(async () => {
        if (config == null) return;
        const enabled = !config.settings?.experimental_wasm_backend;
        const confirmed = confirm(
            `${enabled ? "Enabling" : "Disabling"} the experimental wasm backend restarts the app. Running queries are cancelled and computed results are lost.\n\nRestart now?`
        );
        if (!confirmed) return;
        const settings: AppSettingsValue = { ...(config.settings ?? {}), experimental_wasm_backend: enabled };
        setIsRestarting(true);
        try {
            // The restart reloads the tab before the settings sync would persist the settings
            await storageReader.backend.saveAppSettings(settings);
            reconfigure((value: AppConfig | null) => (value == null ? null : { ...value, settings }));
            await restartApp();
        } catch (error) {
            logger.warn("Failed to restart the app", {
                error: error instanceof Error ? error.message : String(error)
            }, "app_settings");
            setIsRestarting(false);
        }
    }, [config, reconfigure, restartApp, storageReader, logger]);
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
    const keywordCase = config?.settings?.keywordCase === 'upper' ? 'upper' : 'lower';
    const setKeywordCase = (value: 'lower' | 'upper') => {
        reconfigure(config => config == null ? null : {
            ...config,
            settings: { ...config.settings, keywordCase: value },
        });
    };
    const flavor = useAppFlavor();
    const flavorRequested = useRequestedAppFlavor() != null;
    const flavors = [...FLAVORS.values()];
    // The settings of a flavor are layered over the current settings when switching to it
    const setFlavor = (next: AppFlavor) => {
        reconfigure(config => config == null ? null : {
            ...config,
            settings: { ...config.settings, ...next.settings, flavor: next.id },
        });
    };
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

    const clearStorage = React.useCallback(async () => {
        if (!storageReader.backend.clearAllStorage) {
            logger.warn("clearAllStorage not supported by storage backend", {}, "app_settings");
            return;
        }

        const confirmed = confirm(
            "This will delete ALL stored data including all connections, sessions, and scripts. This action cannot be undone.\n\nAre you sure you want to clear all storage?"
        );

        if (!confirmed) {
            return;
        }

        try {
            setIsClearing(true);
            logger.info("Clearing all storage", {}, "app_settings");
            await storageReader.backend.clearAllStorage();
            // The query results of every connection, files that other windows read right now stay
            await queryResultCache?.clear();
            logger.info("Storage cleared successfully", {}, "app_settings");
            alert("Storage cleared successfully. The page will now reload.");
            window.location.reload();
        } catch (error) {
            logger.warn("Failed to clear storage", {
                error: error instanceof Error ? error.message : String(error)
            }, "app_settings");
            alert(`Failed to clear storage: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            setIsClearing(false);
        }
    }, [storageReader, queryResultCache, logger]);

    // A row with the name of a boolean setting and its switch
    const toggle = (key: ToggleSettingKey, name: string, defaultValue: boolean = false) => {
        const id = `app-setting-${key}`;
        return (
            <React.Fragment key={key}>
                <div id={id} className={styles.setting_name}>
                    {name}
                </div>
                <div className={styles.setting_switch}>
                    <ToggleSwitch
                        size="medium"
                        checked={config?.settings?.[key] ?? defaultValue}
                        onClick={() => toggleSetting(key, defaultValue)}
                        disabled={config == null}
                        aria-labelledby={id}
                    />
                </div>
            </React.Fragment>
        );
    };

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
                <SettingsSection title="General" hideTitle>
                    <div
                        id="app-setting-flavor"
                        className={styles.setting_name}
                        title={flavorRequested ? 'The flavor is set by the url' : undefined}
                    >
                        Flavor
                    </div>
                    <div className={styles.setting_switch}>
                        <SegmentedControl
                            aria-labelledby="app-setting-flavor"
                            onChange={index => setFlavor(flavors[index])}
                        >
                            {flavors.map(f => (
                                <SegmentedControl.Button
                                    key={f.id}
                                    selected={flavor.id === f.id}
                                    disabled={config == null || flavorRequested}
                                >
                                    {f.displayName}
                                </SegmentedControl.Button>
                            ))}
                        </SegmentedControl>
                    </div>
                    {toggle('agentFace', 'Agent Face', true)}
                    <div id="app-setting-keyword-case" className={styles.setting_name}>
                        SQL Keyword Case
                    </div>
                    <div className={styles.setting_switch}>
                        <SegmentedControl
                            aria-labelledby="app-setting-keyword-case"
                            onChange={index => setKeywordCase(index === 0 ? 'lower' : 'upper')}
                        >
                            <SegmentedControl.Button selected={keywordCase === 'lower'} disabled={config == null}>
                                Lowercase
                            </SegmentedControl.Button>
                            <SegmentedControl.Button selected={keywordCase === 'upper'} disabled={config == null}>
                                Uppercase
                            </SegmentedControl.Button>
                        </SegmentedControl>
                    </div>
                </SettingsSection>
                <SettingsSection title="Layout">
                    {toggle('narrowScreenLayout', 'Narrow Screen Layout')}
                    {toggle('macWindowLayout', 'Mac Window Layout')}
                </SettingsSection>
                <SettingsSection title="Experimental">
                    {toggle('experimental_file_attachments', 'File Attachments')}
                    <div
                        id="app-setting-experimental-wasm-backend"
                        className={styles.setting_name}
                        title="Runs the embedded Hyper on its experimental wasm backend. Changing it restarts the app."
                    >
                        Wasm Backend
                    </div>
                    <div className={styles.setting_switch}>
                        <ToggleSwitch
                            size="medium"
                            checked={config?.settings?.experimental_wasm_backend ?? false}
                            onClick={toggleExperimentalWasmBackend}
                            disabled={config == null || isRestarting}
                            aria-labelledby="app-setting-experimental-wasm-backend"
                        />
                    </div>
                </SettingsSection>
                <SettingsSection title="Debugging">
                    <div id="app-setting-min-log-level" className={styles.setting_name}>
                        Minimum Log Level
                    </div>
                    <div className={styles.setting_switch}>
                        <SegmentedControl
                            aria-labelledby="app-setting-min-log-level"
                            onChange={index => setMinLogLevel(LOG_LEVELS[index].level)}
                        >
                            {LOG_LEVELS.map(({ level, label }) => (
                                <SegmentedControl.Button key={level} selected={minLogLevel === level}>
                                    {label}
                                </SegmentedControl.Button>
                            ))}
                        </SegmentedControl>
                    </div>
                    {toggle('scriptDebugMode', 'Script Debug Mode')}
                    {toggle('tableDebugMode', 'Table Debug Mode')}
                    {toggle('formattingDebugMode', 'Formatting Debug Mode')}
                </SettingsSection>
                <SettingsSection title="Login & Setup">
                    {toggle('forceReLogin', 'Force Re-Login')}
                    <div className={styles.setting_name}>
                        Revert Setup Confirmation
                    </div>
                    <div className={styles.setting_switch}>
                        <Button onClick={revertSetupConfirmation}>
                            Restart
                        </Button>
                    </div>
                </SettingsSection>
                <div className={styles.reset_section}>
                    <div className={styles.reset_actions}>
                        <Button
                            variant={ButtonVariant.Danger}
                            onClick={clearStorage}
                            disabled={isClearing}
                            aria-label="Reset app state"
                        >
                            {isClearing ? "Resetting..." : "Reset App State"}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}

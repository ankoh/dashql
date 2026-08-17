import * as React from 'react';

import * as styles from './notebook_export_settings_view.module.css';
import { ToggleSwitch } from '../../../ui/foundations/toggle_switch.js';

export interface NotebookExportSettings {
    withCatalog: boolean;
    withLoginHint: boolean;
}

interface Props {
    withCatalog: boolean;
    // Whether the connection actually has a login hint to share. When false the login-hint toggle
    // is disabled and forced off — there is nothing to include.
    withLoginHint: boolean;
    settings: NotebookExportSettings;
    setSettings: (s: NotebookExportSettings) => void;
}

export const NotebookExportSettingsView: React.FC<Props> = (props: Props) => {

    const toggleCatalog = React.useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        props.setSettings({ ...props.settings, withCatalog: !props.settings.withCatalog });
    }, [props.settings, props.setSettings]);

    const toggleLoginHint = React.useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        props.setSettings({ ...props.settings, withLoginHint: !props.settings.withLoginHint });
    }, [props.settings, props.setSettings]);

    return (
        <div className={styles.root}>
            <div className={styles.part_list}>
                <div id="export-toggle-login-hint-label" className={styles.part_name}>
                    Login Hint
                </div>
                <div className={styles.part_toggle}>
                    <ToggleSwitch
                        size="medium"
                        checked={props.withLoginHint && props.settings.withLoginHint}
                        disabled={!props.withLoginHint}
                        onClick={toggleLoginHint}
                        aria-labelledby="export-toggle-login-hint-label"
                    />
                </div>
                <div id="export-toggle-notebook-label" className={styles.part_name}>
                    Notebook Data
                </div>
                <div className={styles.part_toggle}>
                    <ToggleSwitch size="medium" checked={true} disabled={true} aria-labelledby="export-toggle-notebook-label" />
                </div>
                <div id="export-toggle-catalog-label" className={styles.part_name}>
                    Catalog Data
                </div>
                <div className={styles.part_toggle}>
                    <ToggleSwitch
                        size="medium"
                        checked={props.settings.withCatalog}
                        disabled={!props.withCatalog}
                        onClick={toggleCatalog}
                        aria-labelledby="export-toggle-catalog-label"
                    />
                </div>
            </div>
        </div>
    );
};

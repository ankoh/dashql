import * as React from 'react';

import * as styles from './notebook_export_settings_view.module.css';
import { ToggleSwitch } from '../foundations/toggle_switch.js';

export interface NotebookExportSettings {
    withCatalog: boolean;
}

interface Props {
    withCatalog: boolean;
    settings: NotebookExportSettings;
    setSettings: (s: NotebookExportSettings) => void;
}

export const NotebookExportSettingsView: React.FC<Props> = (props: Props) => {

    const toggleCatalog = React.useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        props.setSettings({ ...props.settings, withCatalog: !props.settings.withCatalog });
    }, [props.settings, props.setSettings]);

    return (
        <div className={styles.root}>
            <div className={styles.part_list}>
                <div id="export-toggle-connection-label" className={styles.part_name}>
                    Connection Settings
                </div>
                <div className={styles.part_toggle}>
                    <ToggleSwitch size="small" checked={true} disabled={true} aria-labelledby="export-toggle-connection-label" />
                </div>
                <div id="export-toggle-notebook-label" className={styles.part_name}>
                    Notebook Data
                </div>
                <div className={styles.part_toggle}>
                    <ToggleSwitch size="small" checked={true} disabled={true} aria-labelledby="export-toggle-notebook-label" />
                </div>
                <div id="export-toggle-catalog-label" className={styles.part_name}>
                    Catalog Data
                </div>
                <div className={styles.part_toggle}>
                    <ToggleSwitch
                        size="small"
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

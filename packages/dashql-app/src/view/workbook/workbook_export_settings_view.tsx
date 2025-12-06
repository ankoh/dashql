import * as React from 'react';

import { ToggleSwitch } from '@primer/react';

import * as styles from './workbook_export_settings_view.module.css';

export interface WorkbookExportSettings {
    withCatalog: boolean;
}

interface Props {
    withCatalog: boolean;
    settings: WorkbookExportSettings;
    setSettings: (s: WorkbookExportSettings) => void;
}

export const WorkbookExportSettingsView: React.FC<Props> = (props: Props) => {

    const toggleCatalog = React.useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        props.setSettings({ ...props.settings, withCatalog: !props.settings.withCatalog });
    }, [props.settings, props.setSettings]);

    return (
        <div className={styles.root}>
            <div className={styles.part_list}>
                <div className={styles.part_name}>
                    Connection Settings
                </div>
                <div className={styles.part_toggle}>
                    <ToggleSwitch size="small" checked={true} disabled={true} />
                </div>
                <div className={styles.part_name}>
                    Workbook Data
                </div>
                <div className={styles.part_toggle}>
                    <ToggleSwitch size="small" checked={true} disabled={true} />
                </div>
                <div className={styles.part_name}>
                    Catalog Data
                </div>
                <div className={styles.part_toggle}>
                    <ToggleSwitch
                        size="small"
                        checked={props.settings.withCatalog}
                        disabled={!props.withCatalog}
                        onClick={toggleCatalog}
                    />
                </div>
            </div>
        </div>
    );
};

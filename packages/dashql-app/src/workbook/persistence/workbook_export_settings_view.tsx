import * as React from 'react';

import * as styles from './workbook_export_settings_view.module.css';
import { ToggleSwitch } from '@akohn/dashql-react/components/toggle_switch';
import { SegmentedControl, SegmentedControlSize } from '@akohn/dashql-react/components/segmented_control';
import { SymbolIcon } from '@akohn/dashql-react/components/symbol_icon';
import { isCloudPreview, type WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';
import { WorkbookViewMode, defaultViewOfViewMode, viewModeOfDefaultView } from '../workbook_view_mode.js';

// The views a workbook opens in, with the octicons of the view switch of the workbook bar
const DEFAULT_VIEWS: [WorkbookViewMode, string, ReturnType<typeof SymbolIcon>][] = [
    [WorkbookViewMode.Feed, 'Feed', SymbolIcon('rows_16')],
    [WorkbookViewMode.Dashboard, 'Dashboard', SymbolIcon('dashboard_16')],
    [WorkbookViewMode.Dataflow, 'Dataflow', SymbolIcon('workflow_16')],
];

/// The view that the workbook opens in, a property of the workbook that the export carries
export interface WorkbookDefaultViewSetting {
    view: WorkbookViewMode;
    setView: (view: WorkbookViewMode) => void;
}

/// The default view of a workbook as the export settings show it, none without a workbook. A read-only look at a
/// published workbook keeps the view it came with.
export function useWorkbookDefaultViewSetting(
    workbook: WorkbookScripts | null,
    modify: (action: { kind: 'setDefaultView'; value: { view: string | null } }) => unknown,
): WorkbookDefaultViewSetting | undefined {
    const view = workbook?.defaultView;
    const shown = workbook != null && !isCloudPreview(workbook);
    return React.useMemo(
        () => !shown ? undefined : {
            view: viewModeOfDefaultView(view),
            setView: (next: WorkbookViewMode) => { modify({ kind: 'setDefaultView', value: { view: defaultViewOfViewMode(next) } }); },
        },
        [shown, view, modify],
    );
}

export interface WorkbookExportSettings {
    withCatalog: boolean;
    withLoginHint: boolean;
    preserveUUIDs: boolean;
    /// Carry the cached query results of the scripts, only a file of the workbook does
    withQueryResults?: boolean;
}

interface Props {
    withCatalog: boolean;
    // Whether the connection actually has a login hint to share. When false the login-hint toggle
    // is disabled and forced off — there is nothing to include.
    withLoginHint: boolean;
    settings: WorkbookExportSettings;
    setSettings: (s: WorkbookExportSettings) => void;
    /// Show the toggles of the UUIDs and the catalog, an export of a single connection has neither
    withWorkbookParts?: boolean;
    /// Offer the toggle of the query results, with a line below it, e.g. how many scripts have a cached result
    queryResults?: { hint: string | null };
    /// Offer the choice of the view that the workbook opens in. It changes the workbook, like the bookmark beside the
    /// view switch of the workbook bar.
    defaultView?: WorkbookDefaultViewSetting;
}

export const WorkbookExportSettingsView: React.FC<Props> = (props: Props) => {
    const { settings, setSettings } = props;

    const toggleCatalog = React.useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        setSettings({ ...settings, withCatalog: !settings.withCatalog });
    }, [settings, setSettings]);

    const toggleLoginHint = React.useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        setSettings({ ...settings, withLoginHint: !settings.withLoginHint });
    }, [settings, setSettings]);

    const toggleQueryResults = React.useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        setSettings({ ...settings, withQueryResults: !settings.withQueryResults });
    }, [settings, setSettings]);

    const togglePreserveUUIDs = React.useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        setSettings({ ...settings, preserveUUIDs: !settings.preserveUUIDs });
    }, [settings, setSettings]);

    const defaultView = props.defaultView;
    return (
        <div className={styles.root}>
            <div className={styles.part_list}>
                {defaultView != null && <>
                    <div id="export-default-view-label" className={styles.part_name}>
                        Default View
                    </div>
                    <div className={styles.part_toggle}>
                        <SegmentedControl
                            aria-labelledby="export-default-view-label"
                            data-testid="export-default-view"
                            size={SegmentedControlSize.Small}
                            onChange={index => {
                                const view = DEFAULT_VIEWS[index]?.[0];
                                if (view != null && view !== defaultView.view) defaultView.setView(view);
                            }}
                        >
                            {DEFAULT_VIEWS.map(([view, label, Icon]) => (
                                <SegmentedControl.IconButton
                                    key={view}
                                    aria-label={label}
                                    icon={<Icon size={14} />}
                                    selected={defaultView.view === view}
                                />
                            ))}
                        </SegmentedControl>
                    </div>
                </>}
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
                {props.withWorkbookParts !== false && <>
                    <div id="export-toggle-preserve-uuids-label" className={styles.part_name}>
                        Preserve UUIDs
                    </div>
                    <div className={styles.part_toggle}>
                        <ToggleSwitch
                            size="medium"
                            checked={props.settings.preserveUUIDs}
                            onClick={togglePreserveUUIDs}
                            aria-labelledby="export-toggle-preserve-uuids-label"
                        />
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
                </>}
                {props.queryResults != null && <>
                    <div id="export-toggle-query-results-label" className={styles.part_name}>
                        Query Results
                    </div>
                    <div className={styles.part_toggle}>
                        <ToggleSwitch
                            size="medium"
                            checked={props.settings.withQueryResults ?? false}
                            onClick={toggleQueryResults}
                            aria-labelledby="export-toggle-query-results-label"
                        />
                    </div>
                    {props.queryResults.hint != null && <div className={styles.part_hint} data-testid="export-query-results-hint">
                        {props.queryResults.hint}
                    </div>}
                </>}
            </div>
        </div>
    );
};

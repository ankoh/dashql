import * as React from 'react';
import * as styles from './app_stats_view.module.css';

import { ScriptStatisticsBar } from './workbook/script_statistics_bar.js';
import { useWorkbookRegistry } from '../workbook/workbook_state_registry.js';

import { XIcon } from '@primer/octicons-react';
import { ButtonVariant, IconButton } from '../view/foundations/button.js';
import { WorkbookState } from '../workbook/workbook_state.js';
import { useConnectionRegistry } from '../connection/connection_registry.js';
import { Identicon } from './foundations/identicon.js';

export function AppStats(props: { onClose: () => void; }) {
    const [workbookRegistry, _modifyWorkbooks] = useWorkbookRegistry();
    const [connReg, _modifyConnReg] = useConnectionRegistry();

    // Collect all workbooks
    let workbooks: WorkbookState[] = [];
    for (const typeWorkbooks of workbookRegistry.workbooksByConnectionType) {
        for (const workbookId of typeWorkbooks) {
            workbooks.push(workbookRegistry.workbookMap.get(workbookId)!);
        }
    }

    // Render stats
    let statsList: React.ReactElement[] = React.useMemo(() => {
        let i = 0;
        let out: React.ReactElement[] = [];
        for (const w of workbooks) {
            for (const s of Object.values(w.scripts)) {
                if (s.statistics.isEmpty()) {
                    continue;
                }
                const connState = connReg.connectionMap.get(w.connectionId)!;
                const connSig = connState.connectionSignature.hash.asPrng();
                const scriptSigHash = connState.connectionSignature.hash.clone();
                scriptSigHash.add(s.scriptKey.toString());
                const scriptSig = scriptSigHash.asPrng();

                out.push(
                    <Identicon
                        key={i++}
                        className={styles.script_stats_icon_container}
                        layers={[
                            connSig.next(),
                            connSig.next(),
                            scriptSig.next(),
                        ]}
                    />
                );
                out.push(
                    <div key={i++} className={styles.script_stats_metrics_histogram}>
                        <ScriptStatisticsBar stats={s.statistics} />
                    </div>
                );
            }
        }
        return out;
    }, [workbookRegistry]);

    return (
        <div className={styles.settings_root}>
            <div className={styles.header_container}>
                <div className={styles.header_left_container}>
                    <div className={styles.title}>App Statistics</div>
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
                <div className={styles.script_stats_container}>
                    <div className={styles.script_stats_topic}>
                        Script Processing
                    </div>
                    <div className={styles.script_stats_list}>
                        {statsList}
                    </div>
                </div>
            </div>
        </div>
    );
}

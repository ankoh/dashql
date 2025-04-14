import * as React from 'react';

import * as styles from './workbook_entry_list.module.css';

import { ScriptData, ScriptKey, SELECT_ENTRY, WorkbookEntry, WorkbookState } from "../../workbook/workbook_state.js";
import { useConnectionRegistry } from '../../connection/connection_registry.js';
import { Identicon } from '../../view/foundations/identicon.js';
import { ModifyWorkbook } from '../../workbook/workbook_state_registry.js';

interface WorkbookEntryProps {
    workbook: WorkbookState;
    modifyWorkbook: ModifyWorkbook;
    entryIndex: number;
    entry: WorkbookEntry;
    scriptKey: ScriptKey;
    script: ScriptData;
}

function WorkbookScriptEntry(props: WorkbookEntryProps) {
    // Compute the connection signature
    const [connReg, _modifyConnReg] = useConnectionRegistry();
    const connState = connReg.connectionMap.get(props.workbook.connectionId)!;
    const connSig = connState.connectionSignature.seed.asSfc32();

    // Compute the entry signature
    const entrySigHasher = React.useMemo(() => {
        const seed = connState.connectionSignature.seed.clone();
        seed.add(props.scriptKey.toString());
        return seed;
    }, [props.entryIndex]);
    const entrySig = entrySigHasher.asSfc32();

    // Callback to select a workbook
    const selectWorkbook = () => {
        props.modifyWorkbook({
            type: SELECT_ENTRY,
            value: props.entryIndex
        });
    };

    return (
        <div className={styles.entry_container} onClick={selectWorkbook}>
            <Identicon
                className={styles.entry_icon_container}
                layers={[
                    connSig.next(),
                    connSig.next(),
                    entrySig.next(),
                ]}
            />
        </div>
    );
}

interface ListProps {
    workbook: WorkbookState | null;
    modifyWorkbook: ModifyWorkbook | null;
}

export function WorkbookEntryList(props: ListProps) {
    if (props.workbook == null || props.modifyWorkbook == null) {
        return <div />;
    }

    const scripts = props.workbook.workbookEntries.map(e => props.workbook!.scripts[e.scriptKey]);

    return (
        <div className={styles.entry_list}>
            {scripts.map((v, i) => (
                <WorkbookScriptEntry
                    key={i}
                    workbook={props.workbook!}
                    modifyWorkbook={props.modifyWorkbook!}
                    entryIndex={i}
                    entry={props.workbook!.workbookEntries[i]}
                    scriptKey={v.scriptKey}
                    script={v}
                />
            ))}
        </div>
    );
}

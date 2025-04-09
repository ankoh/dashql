import * as React from 'react';

import * as styles from './workbook_entry_list.module.css';

import { ScriptData, ScriptKey, WorkbookEntry, WorkbookState } from "../../workbook/workbook_state.js";
import { Cyrb128 } from '../../utils/prng.js';
import { computeConnectionSignature } from '../../connection/connection_state.js';
import { useConnectionRegistry } from '../../connection/connection_registry.js';
import { Identicon } from '../../view/foundations/identicon.js';

interface WorkbookEntryProps {
    workbook: WorkbookState;
    entryIndex: number;
    entry: WorkbookEntry;
    scriptKey: ScriptKey;
    script: ScriptData;
}

function WorkbookScriptEntry(props: WorkbookEntryProps) {
    // Compute the connection signature
    const [connReg, _modifyConnReg] = useConnectionRegistry();
    const connState = connReg.connectionMap.get(props.workbook.connectionId)!;
    const connSigHasher = React.useMemo(() => {
        const seed = new Cyrb128();
        if (props.workbook != null) {
            computeConnectionSignature(connState, seed);
        }
        return seed;
    }, [connState?.details]);
    const connSig = connSigHasher.asSfc32();

    // Compute the entry signature
    const entrySigHasher = React.useMemo(() => {
        const seed = connSigHasher.clone();
        seed.add(props.scriptKey.toString());
        return seed;
    }, [props.entryIndex]);
    const entrySig = entrySigHasher.asSfc32();

    return (
        <div className={styles.entry_container}>
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
}

export function WorkbookEntryList(props: ListProps) {
    if (props.workbook == null) {
        return <div />;
    }

    const scripts = props.workbook.workbookEntries.map(e => props.workbook!.scripts[e.scriptKey]);

    return (
        <div className={styles.entry_list}>
            {scripts.map((v, i) => (
                <WorkbookScriptEntry
                    key={i}
                    workbook={props.workbook!}
                    entryIndex={i}
                    entry={props.workbook!.workbookEntries[i]}
                    scriptKey={v.scriptKey}
                    script={v}
                />
            ))}
        </div>
    );
}

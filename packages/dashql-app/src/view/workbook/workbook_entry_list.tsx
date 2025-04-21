import * as React from 'react';

import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import * as symbols from '../../../static/svg/symbols.generated.svg';
import * as styles from './workbook_entry_list.module.css';

import { ScriptData, ScriptKey, SELECT_ENTRY, REORDER_WORKBOOK_ENTRIES, CREATE_WORKBOOK_ENTRY, WorkbookEntry, WorkbookState } from "../../workbook/workbook_state.js";
import { useConnectionRegistry } from '../../connection/connection_registry.js';
import { Identicon } from '../../view/foundations/identicon.js';
import { ModifyWorkbook } from '../../workbook/workbook_state_registry.js';
import { classNames } from '../../utils/classnames.js';
import { ButtonVariant, IconButton } from '../../view/foundations/button.js';

interface WorkbookEntryProps {
    id: string;
    workbook: WorkbookState;
    modifyWorkbook: ModifyWorkbook;
    entryIndex: number;
    entry: WorkbookEntry;
    scriptKey: ScriptKey;
    script: ScriptData;
    selectWorkbook: (entryIdx: number) => void;
}

function WorkbookScriptEntry(props: WorkbookEntryProps) {
    // Compute the connection signature
    const [connReg, _modifyConnReg] = useConnectionRegistry();
    const connState = connReg.connectionMap.get(props.workbook.connectionId)!;
    const connSig = connState.connectionSignature.hash.asPrng();

    // Compute the entry signature
    const entrySigHash = React.useMemo(() => {
        const seed = connState.connectionSignature.hash.clone();
        seed.add(props.scriptKey.toString());
        return seed;
    }, [connState.connectionSignature.hash, props.scriptKey]);
    const entrySig = entrySigHash.asPrng();

    // Setup drag and drop
    const sortable = useSortable({ id: props.id });
    const dndStyles = {
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
        opacity: sortable.isDragging ? 0.5 : 1,
    };

    const selected = props.entryIndex == props.workbook.selectedWorkbookEntry;
    return (
        <div
            ref={sortable.setNodeRef}
            style={dndStyles}
            {...sortable.attributes}
            {...sortable.listeners}
            className={classNames(styles.entry_container, {
                [styles.selected]: selected,
            })}
            onClick={() => props.selectWorkbook(props.entryIndex)}
        >
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

    const lastDragEnd = React.useRef<Date | null>(null);
    const handleDragEnd = (event: any) => {
        const { active, over } = event;
        if (!active || !over) {
            return;
        }
        if (active.id !== over.id) {
            const oldIndex = props.workbook!.workbookEntries.findIndex(entry => entry.scriptKey.toString() === active.id);
            const newIndex = props.workbook!.workbookEntries.findIndex(entry => entry.scriptKey.toString() === over.id);
            if (oldIndex === -1 || newIndex === -1) {
                return;
            }
            lastDragEnd.current = new Date();
            props.modifyWorkbook!({
                type: REORDER_WORKBOOK_ENTRIES,
                value: {
                    oldIndex,
                    newIndex,
                }
            });
        }
    };
    const selectWorkbook = (entryIdx: number) => {
        // Just finished drag?
        // Then we skip the entry selection.
        const now = new Date();
        if (lastDragEnd.current != null && (now.getTime() - lastDragEnd.current.getTime()) < 100) {
            return;
        }
        props.modifyWorkbook!({
            type: SELECT_ENTRY,
            value: entryIdx
        });
    };

    // Setup the drag-and-drop listeners
    const dndSensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8, // Only start dragging after moving 8px
                delay: 100, // Or after holding for 100ms
                tolerance: 10,
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const scripts = props.workbook.workbookEntries.map(e => props.workbook!.scripts[e.scriptKey]);
    return (
        <DndContext
            sensors={dndSensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
        >
            <SortableContext
                items={scripts.map(s => s.scriptKey.toString())}
                strategy={verticalListSortingStrategy}
            >
                <div className={styles.entry_list}>
                    {scripts.map((v, i) => (
                        <WorkbookScriptEntry
                            key={v.scriptKey.toString()}
                            id={v.scriptKey.toString()}
                            workbook={props.workbook!}
                            modifyWorkbook={props.modifyWorkbook!}
                            entryIndex={i}
                            entry={props.workbook!.workbookEntries[i]}
                            scriptKey={v.scriptKey}
                            script={v}
                            selectWorkbook={selectWorkbook}
                        />
                    ))}
                    <div
                        className={styles.entry_add_container}
                        onClick={() => {
                            if (props.modifyWorkbook) {
                                props.modifyWorkbook({
                                    type: CREATE_WORKBOOK_ENTRY,
                                    value: null
                                });
                            }
                        }}
                    >
                        <IconButton
                            className={styles.entry_add_icon_container}
                            variant={ButtonVariant.Invisible}
                            aria-label="Add Workbook"
                        >
                            <svg width="14px" height="14px">
                                <use xlinkHref={`${symbols}#plus_16`} />
                            </svg>
                        </IconButton>
                    </div>
                </div>
            </SortableContext>
        </DndContext>
    );
}

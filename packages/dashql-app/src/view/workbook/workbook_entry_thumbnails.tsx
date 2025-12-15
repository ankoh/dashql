import * as React from 'react';

import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, useDroppable, DragOverlay } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { motion, AnimatePresence } from 'framer-motion';

import * as symbols from '../../../static/svg/symbols.generated.svg';
import * as styles from './workbook_entry_thumbnails.module.css';

import { ScriptData, ScriptKey, SELECT_ENTRY, REORDER_WORKBOOK_ENTRIES, CREATE_WORKBOOK_ENTRY, WorkbookEntry, WorkbookState, DELETE_WORKBOOK_ENTRY } from "../../workbook/workbook_state.js";
import { useConnectionRegistry } from '../../connection/connection_registry.js';
import { Identicon } from '../../view/foundations/identicon.js';
import { ModifyWorkbook } from '../../workbook/workbook_state_registry.js';
import { classNames } from '../../utils/classnames.js';
import { ButtonVariant, IconButton } from '../../view/foundations/button.js';

const WORKBOOK_TRASH_DROPZONE = "workbook-trash-dropzone";

interface WorkbookEntryProps {
    id: string;
    workbook: WorkbookState;
    entryIndex: number;
    entry: WorkbookEntry;
    scriptKey: ScriptKey;
    script: ScriptData;
    selectWorkbook?: (entryIdx: number) => void;
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

    const containsTableDefs = props.script.annotations.tableDefs.length > 0;
    const isSelected = props.entryIndex == props.workbook.selectedWorkbookEntry;
    const selectWorkbook = props.selectWorkbook;

    // Cache the rendered icon
    const iconLayers = [
        connSig.next(),
        connSig.next(),
        entrySig.next(),
    ];
    const icon = React.useMemo(() =>
        <Identicon
            className={styles.entry_icon_container}
            layers={iconLayers}
        />
        , iconLayers);

    return (
        <div
            ref={sortable.setNodeRef}
            style={dndStyles}
            {...sortable.attributes}
            {...sortable.listeners}
            className={classNames(styles.entry_container, {
                [styles.selected]: isSelected,
            })}
            onClick={selectWorkbook ? () => selectWorkbook(props.entryIndex) : undefined}
        >
            {icon}
            {containsTableDefs && (
                <div className={styles.entry_type_container}>
                    <svg width="8px" height="8px">
                        <use xlinkHref={`${symbols}#database`} />
                    </svg>
                </div>
            )}
        </div>
    );
}

function WorkbookDeletionZone(_props: {}) {
    const { setNodeRef, isOver } = useDroppable({
        id: WORKBOOK_TRASH_DROPZONE,
    });
    return (
        <motion.div
            className={classNames(styles.entry_delete_zone_container, {
                [styles.over]: isOver
            })}
            ref={setNodeRef}
            aria-label="Delete Workbook"

            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
        >
            <svg width="14px" height="14px">
                <use xlinkHref={`${symbols}#trash_16`} />
            </svg>
        </motion.div>
    );
}

interface ListProps {
    workbook: WorkbookState | null;
    modifyWorkbook: ModifyWorkbook | null;
}

export function WorkbookEntryThumbnails(props: ListProps) {
    if (props.workbook == null || props.modifyWorkbook == null) {
        return <div />;
    }

    const lastDragEnd = React.useRef<Date | null>(null);
    const [draggedElementId, setDraggedElementId] = React.useState<string | null>(null);
    const handleDragStart = (event: any) => {
        setDraggedElementId(event.active.id);
    };
    const handleDragEnd = (event: any) => {
        setDraggedElementId(null);
        const { active, over } = event;
        if (!active || !over) {
            return;
        }
        if (over.id == WORKBOOK_TRASH_DROPZONE) {
            const draggedEntry = props.workbook!.workbookEntries.findIndex(entry => entry.scriptKey.toString() === active.id);
            if (draggedEntry == -1) {
                return;
            }
            props.modifyWorkbook!({
                type: DELETE_WORKBOOK_ENTRY,
                value: draggedEntry,
            });
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
                distance: 4,
                delay: 150,
                tolerance: 10,
            },
        }),
    );

    const scripts = props.workbook.workbookEntries.map(e => props.workbook!.scripts[e.scriptKey]);
    return (
        <DndContext
            sensors={dndSensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
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
                            entryIndex={i}
                            entry={props.workbook!.workbookEntries[i]}
                            scriptKey={v.scriptKey}
                            script={v}
                            selectWorkbook={selectWorkbook}
                        />
                    ))}
                </div>
            </SortableContext>
            <div className={styles.entry_list_modify_container}>
                <AnimatePresence>
                    {draggedElementId != null
                        ? <WorkbookDeletionZone />
                        : (
                            <motion.div
                                initial={{ scale: 0, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0, opacity: 0 }}
                                transition={{ duration: 0.2, ease: "easeOut" }}
                            >
                                <IconButton
                                    className={styles.entry_add_button_container}
                                    variant={ButtonVariant.Invisible}
                                    aria-label="Add Workbook"
                                    onClick={() => {
                                        if (props.modifyWorkbook) {
                                            props.modifyWorkbook({
                                                type: CREATE_WORKBOOK_ENTRY,
                                                value: null
                                            });
                                        }
                                    }}
                                >
                                    <svg width="14px" height="14px">
                                        <use xlinkHref={`${symbols}#plus_16`} />
                                    </svg>
                                </IconButton>
                            </motion.div>
                        )}
                </AnimatePresence>
            </div>
            <DragOverlay>
                {(draggedElementId != null) ? (
                    <WorkbookScriptEntry
                        id={draggedElementId}
                        workbook={props.workbook!}
                        entryIndex={scripts.findIndex(s => s.scriptKey.toString() === draggedElementId)}
                        entry={props.workbook!.workbookEntries.find(e => e.scriptKey.toString() === draggedElementId)!}
                        scriptKey={parseInt(draggedElementId)}
                        script={scripts.find(s => s.scriptKey.toString() === draggedElementId)!}
                        selectWorkbook={selectWorkbook}
                    />
                ) : null}
            </DragOverlay>
        </DndContext>
    );
}

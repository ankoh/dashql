import * as React from 'react';
import * as pb from '@ankoh/dashql-protobuf';

import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, useDroppable, DragOverlay } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { motion, AnimatePresence } from 'framer-motion';

import symbols from '../../../static/svg/symbols.generated.svg';
import * as styles from './notebook_entry_thumbnails.module.css';

import { getSelectedPageEntries, ScriptData, ScriptKey, SELECT_ENTRY, REORDER_NOTEBOOK_ENTRIES, CREATE_NOTEBOOK_ENTRY, NotebookState, DELETE_NOTEBOOK_ENTRY } from "../../notebook/notebook_state.js";
import { useConnectionRegistry } from '../../connection/connection_registry.js';
import { Identicon } from '../../view/foundations/identicon.js';
import { ModifyNotebook } from '../../notebook/notebook_state_registry.js';
import { classNames } from '../../utils/classnames.js';
import { ButtonVariant, IconButton } from '../../view/foundations/button.js';

const NOTEBOOK_TRASH_DROPZONE = "notebook-trash-dropzone";

interface NotebookEntryProps {
    id: string;
    notebook: NotebookState;
    entryIndex: number;
    entry: pb.dashql.notebook.NotebookPageScript;
    scriptKey: ScriptKey;
    script: ScriptData;
    selectNotebook?: (entryIdx: number) => void;
}

function NotebookScriptEntry(props: NotebookEntryProps) {
    // Compute the connection signature
    const [connReg, _modifyConnReg] = useConnectionRegistry();
    const connState = connReg.connectionMap.get(props.notebook.connectionId)!;
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
    const isSelected = props.entryIndex === props.notebook.selectedEntryInPage;
    const selectNotebook = props.selectNotebook;

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
            onClick={selectNotebook ? () => selectNotebook(props.entryIndex) : undefined}
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

function NotebookDeletionZone(_props: {}) {
    const { setNodeRef, isOver } = useDroppable({
        id: NOTEBOOK_TRASH_DROPZONE,
    });
    return (
        <motion.div
            className={classNames(styles.entry_delete_zone_container, {
                [styles.over]: isOver
            })}
            ref={setNodeRef}
            aria-label="Delete Notebook"

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
    notebook: NotebookState | null;
    modifyNotebook: ModifyNotebook | null;
}

export function NotebookEntryThumbnails(props: ListProps) {
    if (props.notebook == null || props.modifyNotebook == null) {
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
        const entries = getSelectedPageEntries(props.notebook!);
        if (over.id == NOTEBOOK_TRASH_DROPZONE) {
            const draggedEntry = entries.findIndex(entry => entry.scriptId.toString() === active.id);
            if (draggedEntry == -1) {
                return;
            }
            props.modifyNotebook!({
                type: DELETE_NOTEBOOK_ENTRY,
                value: draggedEntry,
            });
            return;
        }
        if (active.id !== over.id) {
            const oldIndex = entries.findIndex(entry => entry.scriptId.toString() === active.id);
            const newIndex = entries.findIndex(entry => entry.scriptId.toString() === over.id);
            if (oldIndex === -1 || newIndex === -1) {
                return;
            }
            lastDragEnd.current = new Date();
            props.modifyNotebook!({
                type: REORDER_NOTEBOOK_ENTRIES,
                value: {
                    oldIndex,
                    newIndex,
                }
            });
        }
    };
    const selectNotebook = (entryIdx: number) => {
        // Just finished drag?
        // Then we skip the entry selection.
        const now = new Date();
        if (lastDragEnd.current != null && (now.getTime() - lastDragEnd.current.getTime()) < 100) {
            return;
        }
        props.modifyNotebook!({
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

    const entries = getSelectedPageEntries(props.notebook);
    const scripts = entries.map(e => props.notebook!.scripts[e.scriptId]);
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
                        <NotebookScriptEntry
                            key={v.scriptKey.toString()}
                            id={v.scriptKey.toString()}
                            notebook={props.notebook!}
                            entryIndex={i}
                            entry={entries[i]}
                            scriptKey={v.scriptKey}
                            script={v}
                            selectNotebook={selectNotebook}
                        />
                    ))}
                </div>
            </SortableContext>
            <div className={styles.entry_list_modify_container}>
                <AnimatePresence>
                    {draggedElementId != null
                        ? <NotebookDeletionZone />
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
                                    aria-label="Add Notebook"
                                    onClick={() => {
                                        if (props.modifyNotebook) {
                                            props.modifyNotebook({
                                                type: CREATE_NOTEBOOK_ENTRY,
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
                    <NotebookScriptEntry
                        id={draggedElementId}
                        notebook={props.notebook!}
                        entryIndex={scripts.findIndex(s => s.scriptKey.toString() === draggedElementId)}
                        entry={entries.find(e => e.scriptId.toString() === draggedElementId)!}
                        scriptKey={parseInt(draggedElementId)}
                        script={scripts.find(s => s.scriptKey.toString() === draggedElementId)!}
                        selectNotebook={selectNotebook}
                    />
                ) : null}
            </DragOverlay>
        </DndContext>
    );
}

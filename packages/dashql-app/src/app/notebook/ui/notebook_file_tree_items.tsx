import * as React from 'react';
import * as styles from './notebook_file_tree.module.css';

import {
    DndContext,
    PointerSensor,
    closestCenter,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import {
    SortableContext,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
    DatabaseIcon,
    FileDirectoryFillIcon,
    FileDirectoryOpenFillIcon,
    GraphIcon,
} from '@primer/octicons-react';

import { normalizeScriptFolderName, scriptDisplayName } from '../scripts/script_types.js';
import { classNames } from '../../../utils/classnames.js';
import { ButtonSize, ButtonVariant, IconButton } from '../../../ui/foundations/button.js';
import { SymbolIcon } from '../../../ui/foundations/symbol_icon.js';
import { useInlineRename } from './use_inline_rename.js';

interface SortableScriptProps {
    fileName: string;
    selected: boolean;
    isVisualization: boolean;
    onSelect: () => void;
    onRename: (newFileName: string) => void;
}

const SortableScript: React.FC<SortableScriptProps> = (props) => {
    const label = scriptDisplayName(props.fileName) || 'Untitled';
    const PencilIcon = SymbolIcon('pencil_16');
    const rename = useInlineRename(label, props.onRename);
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: props.fileName,
        disabled: rename.editing,
    });
    const style: React.CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 1 : undefined,
        opacity: isDragging ? 0.75 : undefined,
    };
    return (
        <li ref={setNodeRef} style={style} className={styles.sortable_item}>
            {rename.editing ? (
                <div className={classNames(styles.folder_edit, styles.script_edit)}>
                    {props.isVisualization
                        ? <GraphIcon size={14} className={styles.item_icon} />
                        : <DatabaseIcon size={14} className={styles.item_icon} />}
                    <input
                        ref={rename.inputRef}
                        type="text"
                        className={classNames(styles.folder_name_input, styles.script_name_input)}
                        aria-label={`Rename ${label} file`}
                        value={rename.draftName}
                        onChange={(event) => rename.setDraftName(event.target.value)}
                        onBlur={rename.saveRename}
                        onKeyDown={rename.handleKeyDown}
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                    />
                </div>
            ) : (
                <>
                    <button
                        type="button"
                        {...attributes}
                        {...listeners}
                        className={classNames(styles.item_button, styles.script_button, {
                            [styles.item_button_selected]: props.selected,
                            [styles.item_button_with_action]: props.selected,
                        })}
                        aria-current={props.selected ? 'page' : undefined}
                        onClick={props.onSelect}
                    >
                        {props.isVisualization
                            ? <GraphIcon size={14} className={styles.item_icon} />
                            : <DatabaseIcon size={14} className={styles.item_icon} />}
                        <span className={styles.item_label}>{label}</span>
                    </button>
                    {props.selected && (
                        <IconButton
                            variant={ButtonVariant.Invisible}
                            size={ButtonSize.Small}
                            className={styles.rename_folder_button}
                            aria-label={`Rename ${label} file`}
                            onClick={rename.beginRename}
                            onPointerDown={(event) => event.stopPropagation()}
                            onKeyDown={(event) => event.stopPropagation()}
                        >
                            <PencilIcon size={12} />
                        </IconButton>
                    )}
                </>
            )}
        </li>
    );
};

interface SortableFolderProps {
    folderName: string;
    active: boolean;
    expanded: boolean;
    selectedFileName: string;
    fileNames: string[];
    visualizationFileNames: ReadonlySet<string>;
    onSelect: () => void;
    onRename: (newFolderName: string) => void;
    onRenameScript: (fileName: string, newFileName: string) => void;
    onSelectScript: (fileName: string) => void;
    onMoveScript: (fromIndex: number, toIndex: number) => void;
}

export const SortableFolder: React.FC<SortableFolderProps> = (props) => {
    const label = normalizeScriptFolderName(props.folderName) || 'Untitled';
    const PencilIcon = SymbolIcon('pencil_16');
    const rename = useInlineRename(label, props.onRename);
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: props.folderName,
        disabled: rename.editing,
    });
    const scriptSensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    );
    const style: React.CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 1 : undefined,
        opacity: isDragging ? 0.75 : undefined,
    };
    return (
        <li ref={setNodeRef} style={style} className={styles.folder_item}>
            <div className={styles.sortable_item}>
                {rename.editing ? (
                    <div className={styles.folder_edit}>
                        {props.expanded
                            ? <FileDirectoryOpenFillIcon size={16} className={styles.item_icon} />
                            : <FileDirectoryFillIcon size={16} className={styles.item_icon} />}
                        <input
                            ref={rename.inputRef}
                            type="text"
                            className={styles.folder_name_input}
                            aria-label={`Rename ${label} folder`}
                            value={rename.draftName}
                            onChange={(event) => rename.setDraftName(event.target.value)}
                            onBlur={rename.saveRename}
                            onKeyDown={rename.handleKeyDown}
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="off"
                            spellCheck={false}
                        />
                    </div>
                ) : (
                    <>
                        <button
                            type="button"
                            {...attributes}
                            {...listeners}
                            className={classNames(styles.item_button, {
                                [styles.item_button_selected]: props.active,
                                [styles.item_button_with_action]: props.active,
                            })}
                            aria-expanded={props.expanded}
                            onClick={props.onSelect}
                        >
                            {props.expanded
                                ? <FileDirectoryOpenFillIcon size={16} className={styles.item_icon} />
                                : <FileDirectoryFillIcon size={16} className={styles.item_icon} />}
                            <span className={styles.item_label}>{label}</span>
                        </button>
                        {props.active && (
                            <IconButton
                                variant={ButtonVariant.Invisible}
                                size={ButtonSize.Small}
                                className={styles.rename_folder_button}
                                aria-label={`Rename ${label} folder`}
                                onClick={rename.beginRename}
                                onPointerDown={(event) => event.stopPropagation()}
                                onKeyDown={(event) => event.stopPropagation()}
                            >
                                <PencilIcon size={12} />
                            </IconButton>
                        )}
                    </>
                )}
            </div>
            {props.expanded && (
                <DndContext
                    sensors={scriptSensors}
                    collisionDetection={closestCenter}
                    onDragEnd={(event) => {
                        if (event.over == null) return;
                        props.onMoveScript(
                            props.fileNames.indexOf(String(event.active.id)),
                            props.fileNames.indexOf(String(event.over.id)),
                        );
                    }}
                >
                    <SortableContext items={props.fileNames} strategy={verticalListSortingStrategy}>
                        <ul className={styles.script_list} aria-label={`${label} scripts`}>
                            {props.fileNames.map((fileName) => (
                                <SortableScript
                                    key={fileName}
                                    fileName={fileName}
                                    selected={fileName === props.selectedFileName}
                                    isVisualization={props.visualizationFileNames.has(fileName)}
                                    onSelect={() => props.onSelectScript(fileName)}
                                    onRename={(newFileName) => props.onRenameScript(fileName, newFileName)}
                                />
                            ))}
                        </ul>
                    </SortableContext>
                </DndContext>
            )}
        </li>
    );
};

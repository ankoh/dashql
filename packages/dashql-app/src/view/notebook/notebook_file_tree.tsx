import * as React from 'react';
import * as styles from './notebook_file_tree.module.css';

import {
    DndContext,
    DragEndEvent,
    PointerSensor,
    closestCenter,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import {
    SortableContext,
    arrayMove,
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

import {
    REORDER_NOTEBOOK_SCRIPTS,
    REORDER_PAGES,
    UPDATE_NOTEBOOK_ENTRY,
    UPDATE_PAGE_FOLDER_NAME,
    getSortedFileNames,
    getSortedFolderNames,
    type NotebookState,
} from '../../notebook/notebook_state.js';
import type { ModifyNotebook } from '../../notebook/notebook_state_registry.js';
import { normalizePageName, scriptDisplayName } from '../../notebook/notebook_types.js';
import { classNames } from '../../utils/classnames.js';
import { ButtonSize, ButtonVariant, IconButton } from '../foundations/button.js';
import { SymbolIcon } from '../foundations/symbol_icon.js';

export type NotebookFileTreeCatalogTab = 'relations' | 'functions';
export type NotebookFileTreeNavigationLevel = 'folders' | 'scripts';

export interface NotebookFileTreeProps {
    notebook: NotebookState;
    modifyNotebook: ModifyNotebook;
    catalogTab: NotebookFileTreeCatalogTab | null;
    navigationLevel: NotebookFileTreeNavigationLevel;
    showCatalogEntries: boolean;
    onSelectFolder: (folder: string) => void;
    onSelectScript: (folder: string, file: string) => void;
    onSelectCatalog: (tab: NotebookFileTreeCatalogTab) => void;
    onAddFolder: () => void;
    className?: string;
}

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
    const [editing, setEditing] = React.useState(false);
    const [draftName, setDraftName] = React.useState(label);
    const inputRef = React.useRef<HTMLInputElement>(null);
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: props.fileName,
        disabled: editing,
    });
    const style: React.CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 1 : undefined,
        opacity: isDragging ? 0.75 : undefined,
    };
    React.useEffect(() => {
        if (editing) {
            inputRef.current?.focus();
            inputRef.current?.select();
        }
    }, [editing]);
    const saveRename = () => {
        const nextName = draftName.trim();
        setEditing(false);
        if (nextName && nextName !== label) props.onRename(nextName);
    };
    return (
        <li ref={setNodeRef} style={style} className={styles.sortable_item}>
            {editing ? (
                <div className={classNames(styles.folder_edit, styles.script_edit)}>
                    {props.isVisualization
                        ? <GraphIcon size={14} className={styles.item_icon} />
                        : <DatabaseIcon size={14} className={styles.item_icon} />}
                    <input
                        ref={inputRef}
                        type="text"
                        className={classNames(styles.folder_name_input, styles.script_name_input)}
                        aria-label={`Rename ${label} file`}
                        value={draftName}
                        onChange={(event) => setDraftName(event.target.value)}
                        onBlur={saveRename}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                event.currentTarget.blur();
                            } else if (event.key === 'Escape') {
                                event.preventDefault();
                                setDraftName(label);
                                setEditing(false);
                            }
                        }}
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
                            onClick={() => {
                                setDraftName(label);
                                setEditing(true);
                            }}
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
    navigationLevel: NotebookFileTreeNavigationLevel;
    onSelect: () => void;
    onRename: (newFolderName: string) => void;
    onRenameScript: (fileName: string, newFileName: string) => void;
    onSelectScript: (fileName: string) => void;
    onMoveScript: (fromIndex: number, toIndex: number) => void;
}

const SortableFolder: React.FC<SortableFolderProps> = (props) => {
    const label = normalizePageName(props.folderName) || 'Untitled';
    const PencilIcon = SymbolIcon('pencil_16');
    const [editing, setEditing] = React.useState(false);
    const [draftName, setDraftName] = React.useState(label);
    const inputRef = React.useRef<HTMLInputElement>(null);
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: props.folderName,
        disabled: editing,
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
    React.useEffect(() => {
        if (editing) {
            inputRef.current?.focus();
            inputRef.current?.select();
        }
    }, [editing]);
    const saveRename = () => {
        const nextName = draftName.trim();
        setEditing(false);
        if (nextName && nextName !== label) props.onRename(nextName);
    };
    return (
        <li ref={setNodeRef} style={style} className={styles.folder_item}>
            <div className={styles.sortable_item}>
                {editing ? (
                    <div className={styles.folder_edit}>
                        {props.expanded
                            ? <FileDirectoryOpenFillIcon size={16} className={styles.item_icon} />
                            : <FileDirectoryFillIcon size={16} className={styles.item_icon} />}
                        <input
                            ref={inputRef}
                            type="text"
                            className={styles.folder_name_input}
                            aria-label={`Rename ${label} folder`}
                            value={draftName}
                            onChange={(event) => setDraftName(event.target.value)}
                            onBlur={saveRename}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    event.currentTarget.blur();
                                } else if (event.key === 'Escape') {
                                    event.preventDefault();
                                    setDraftName(label);
                                    setEditing(false);
                                }
                            }}
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
                            className={classNames(styles.item_button, styles.folder_button, {
                                [styles.item_button_selected]: props.active,
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
                                onClick={() => {
                                    setDraftName(label);
                                    setEditing(true);
                                }}
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

export const NotebookFileTree: React.FC<NotebookFileTreeProps> = (props) => {
    const PlusIcon = SymbolIcon('plus_16');
    const FunctionIcon = SymbolIcon('workflow_16');
    const folders = getSortedFolderNames(props.notebook.notebookPages);
    const selectedFolderName = props.notebook.notebookUserFocus.folderName;
    const selectedPage = props.notebook.notebookPages[selectedFolderName];
    const selectedFileNames = selectedPage ? getSortedFileNames(selectedPage) : [];
    const [collapsedFolderName, setCollapsedFolderName] = React.useState<string | null>(null);
    const visualizationFileNames = new Set(selectedFileNames.filter((fileName) => {
        const scriptId = selectedPage?.scripts[fileName]?.scriptId;
        return scriptId != null && props.notebook.scripts?.[scriptId]?.annotations.visualizeQuery != null;
    }));
    const noVisualizationFiles = new Set<string>();
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    );

    React.useEffect(() => {
        if (props.navigationLevel === 'scripts') {
            setCollapsedFolderName(null);
        }
    }, [props.navigationLevel]);
    const reorderFolders = React.useCallback((fromIndex: number, toIndex: number) => {
        if (fromIndex === toIndex || toIndex < 0 || toIndex >= folders.length) return;
        props.modifyNotebook({ type: REORDER_PAGES, value: arrayMove(folders, fromIndex, toIndex) });
    }, [folders, props.modifyNotebook]);

    const reorderScripts = React.useCallback((fromIndex: number, toIndex: number) => {
        if (fromIndex === toIndex || toIndex < 0 || toIndex >= selectedFileNames.length || !selectedPage) return;
        props.modifyNotebook({
            type: REORDER_NOTEBOOK_SCRIPTS,
            value: {
                folderName: selectedFolderName,
                fileNames: arrayMove(selectedFileNames, fromIndex, toIndex),
            },
        });
    }, [selectedFileNames, selectedFolderName, selectedPage, props.modifyNotebook]);

    const handleFolderDragEnd = React.useCallback((event: DragEndEvent) => {
        if (event.over == null) return;
        reorderFolders(folders.indexOf(String(event.active.id)), folders.indexOf(String(event.over.id)));
    }, [folders, reorderFolders]);
    const handleFolderDragStart = React.useCallback(() => {
        setCollapsedFolderName(selectedFolderName);
    }, [selectedFolderName]);

    return (
        <nav className={classNames(styles.file_tree, props.className)} aria-label="Notebook files" data-notebook-file-tree>
            <div className={styles.pages_container}>
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragStart={handleFolderDragStart}
                    onDragEnd={handleFolderDragEnd}
                >
                    <SortableContext items={folders} strategy={verticalListSortingStrategy}>
                        <ul className={styles.folder_list} aria-label="Notebook pages">
                            {folders.map((folderName) => {
                                const selected = folderName === selectedFolderName;
                                const expanded = selected
                                    && props.navigationLevel === 'scripts'
                                    && collapsedFolderName !== folderName;
                                return (
                                    <SortableFolder
                                        key={folderName}
                                        folderName={folderName}
                                        active={props.catalogTab == null && selected}
                                        expanded={expanded}
                                        selectedFileName={props.catalogTab == null ? props.notebook.notebookUserFocus.fileName : ''}
                                        fileNames={expanded ? selectedFileNames : []}
                                        visualizationFileNames={expanded ? visualizationFileNames : noVisualizationFiles}
                                        navigationLevel={props.navigationLevel}
                                        onRename={(newFolderName) => props.modifyNotebook({
                                            type: UPDATE_PAGE_FOLDER_NAME,
                                            value: { folderName, newFolderName },
                                        })}
                                        onRenameScript={(fileName, newFileName) => props.modifyNotebook({
                                            type: UPDATE_NOTEBOOK_ENTRY,
                                            value: { fileName, newFileName },
                                        })}
                                        onSelect={() => {
                                            if (selected) {
                                                setCollapsedFolderName(expanded ? folderName : null);
                                            } else {
                                                setCollapsedFolderName(null);
                                                props.onSelectFolder(folderName);
                                            }
                                        }}
                                        onSelectScript={(fileName) => props.onSelectScript(folderName, fileName)}
                                        onMoveScript={reorderScripts}
                                    />
                                );
                            })}
                        </ul>
                    </SortableContext>
                </DndContext>
                <button type="button" className={styles.add_folder_button} onClick={props.onAddFolder}>
                    <PlusIcon size={16} />
                    <span>Add Folder</span>
                </button>
            </div>
            {props.showCatalogEntries && (
                <ul className={styles.catalog_list} aria-label="Catalog">
                    <li>
                        <button
                            type="button"
                            className={classNames(styles.item_button, styles.catalog_button, {
                                [styles.item_button_selected]: props.catalogTab === 'relations',
                            })}
                            aria-current={props.catalogTab === 'relations' ? 'page' : undefined}
                            onClick={() => props.onSelectCatalog('relations')}
                        >
                            <DatabaseIcon size={16} className={styles.item_icon} />
                            <span className={styles.item_label}>Relations</span>
                        </button>
                    </li>
                    <li>
                        <button
                            type="button"
                            className={classNames(styles.item_button, styles.catalog_button, {
                                [styles.item_button_selected]: props.catalogTab === 'functions',
                            })}
                            aria-current={props.catalogTab === 'functions' ? 'page' : undefined}
                            onClick={() => props.onSelectCatalog('functions')}
                        >
                            <FunctionIcon size={16} className={styles.item_icon} />
                            <span className={styles.item_label}>Functions</span>
                        </button>
                    </li>
                </ul>
            )}
        </nav>
    );
};

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
    getSortedFileNames,
    getSortedFolderNames,
    type NotebookState,
} from '../../notebook/notebook_state.js';
import type { ModifyNotebook } from '../../notebook/notebook_state_registry.js';
import { normalizePageName, scriptDisplayName } from '../../notebook/notebook_types.js';
import { classNames } from '../../utils/classnames.js';
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
}

const SortableScript: React.FC<SortableScriptProps> = (props) => {
    const label = scriptDisplayName(props.fileName) || 'Untitled';
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: props.fileName,
    });
    const style: React.CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 1 : undefined,
        opacity: isDragging ? 0.75 : undefined,
    };
    return (
        <li ref={setNodeRef} style={style} className={styles.sortable_item}>
            <button
                type="button"
                {...attributes}
                {...listeners}
                className={classNames(styles.item_button, styles.script_button, {
                    [styles.item_button_selected]: props.selected,
                })}
                aria-current={props.selected ? 'page' : undefined}
                onClick={props.onSelect}
            >
                {props.isVisualization
                    ? <GraphIcon size={14} className={styles.item_icon} />
                    : <DatabaseIcon size={14} className={styles.item_icon} />}
                <span className={styles.item_label}>{label}</span>
            </button>
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
    onSelectScript: (fileName: string) => void;
    onMoveScript: (fromIndex: number, toIndex: number) => void;
}

const SortableFolder: React.FC<SortableFolderProps> = (props) => {
    const label = normalizePageName(props.folderName) || 'Untitled';
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: props.folderName,
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
                <button
                    type="button"
                    {...attributes}
                    {...listeners}
                    className={classNames(styles.item_button, {
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

    return (
        <nav className={classNames(styles.file_tree, props.className)} aria-label="Notebook files" data-notebook-file-tree>
            <div className={styles.pages_container}>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleFolderDragEnd}>
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

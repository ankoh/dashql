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
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { DatabaseIcon } from '@primer/octicons-react';

import {
    REORDER_SCRIPTS,
    REORDER_SCRIPT_FOLDERS,
    RENAME_SCRIPT,
    RENAME_SCRIPT_FOLDER,
    getSortedScriptFileNames,
    getSortedScriptFolderNames,
    type NotebookScripts,
} from '../scripts/notebook_scripts.js';
import type { ModifyNotebookScripts } from '../scripts/notebook_scripts_registry.js';
import { classNames } from '../../../utils/classnames.js';
import { SymbolIcon } from '../../../ui/foundations/symbol_icon.js';
import { SortableFolder } from './notebook_file_tree_items.js';

export type NotebookFileTreeCatalogTab = 'relations' | 'functions';
export type NotebookFileTreeNavigationLevel = 'folders' | 'scripts';

export interface NotebookFileTreeProps {
    notebookScripts: NotebookScripts;
    modifyNotebookScripts: ModifyNotebookScripts;
    catalogTab: NotebookFileTreeCatalogTab | null;
    navigationLevel: NotebookFileTreeNavigationLevel;
    showCatalogEntries: boolean;
    onSelectFolder: (folder: string) => void;
    onSelectScript: (folder: string, file: string) => void;
    onSelectCatalog: (tab: NotebookFileTreeCatalogTab) => void;
    onAddFolder: () => void;
    className?: string;
}

export const NotebookFileTree: React.FC<NotebookFileTreeProps> = (props) => {
    const PlusIcon = SymbolIcon('plus_16');
    const FunctionIcon = SymbolIcon('workflow_16');
    const folders = getSortedScriptFolderNames(props.notebookScripts.scriptFolders);
    const selectedFolderName = props.notebookScripts.scriptFocus.folderName;
    const selectedPage = props.notebookScripts.scriptFolders[selectedFolderName];
    const selectedFileNames = selectedPage ? getSortedScriptFileNames(selectedPage) : [];
    const [collapsedFolderName, setCollapsedFolderName] = React.useState<string | null>(null);
    const visualizationFileNames = new Set(selectedFileNames.filter((fileName) => {
        const scriptId = selectedPage?.scripts[fileName]?.scriptId;
        return scriptId != null && props.notebookScripts.scripts?.[scriptId]?.annotations.visualizeQuery != null;
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
        props.modifyNotebookScripts({ type: REORDER_SCRIPT_FOLDERS, value: arrayMove(folders, fromIndex, toIndex) });
    }, [folders, props.modifyNotebookScripts]);

    const reorderScripts = React.useCallback((fromIndex: number, toIndex: number) => {
        if (fromIndex === toIndex || toIndex < 0 || toIndex >= selectedFileNames.length || !selectedPage) return;
        props.modifyNotebookScripts({
            type: REORDER_SCRIPTS,
            value: {
                folderName: selectedFolderName,
                fileNames: arrayMove(selectedFileNames, fromIndex, toIndex),
            },
        });
    }, [selectedFileNames, selectedFolderName, selectedPage, props.modifyNotebookScripts]);

    const handleFolderDragEnd = React.useCallback((event: DragEndEvent) => {
        if (event.over == null) return;
        reorderFolders(folders.indexOf(String(event.active.id)), folders.indexOf(String(event.over.id)));
    }, [folders, reorderFolders]);
    const handleFolderDragStart = React.useCallback(() => {
        setCollapsedFolderName(selectedFolderName);
    }, [selectedFolderName]);

    return (
        <nav
            className={classNames(styles.file_tree, props.className)}
            aria-label="Notebook files"
            data-notebookscripts-file-tree
        >
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
                                        selectedFileName={props.catalogTab == null ? props.notebookScripts.scriptFocus.fileName : ''}
                                        fileNames={expanded ? selectedFileNames : []}
                                        visualizationFileNames={expanded ? visualizationFileNames : noVisualizationFiles}
                                        onRename={(newFolderName) => props.modifyNotebookScripts({
                                            type: RENAME_SCRIPT_FOLDER,
                                            value: { folderName, newFolderName },
                                        })}
                                        onRenameScript={(fileName, newFileName) => props.modifyNotebookScripts({
                                            type: RENAME_SCRIPT,
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

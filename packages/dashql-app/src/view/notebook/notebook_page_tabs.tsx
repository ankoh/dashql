import * as React from 'react';
import * as styles from './notebook_page.module.css';

import {
    DndContext,
    DragEndEvent,
    KeyboardSensor,
    PointerSensor,
    closestCenter,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import {
    SortableContext,
    horizontalListSortingStrategy,
    sortableKeyboardCoordinates,
    useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { ButtonSize, ButtonVariant, IconButton } from '../foundations/button.js';
import { observeSize } from '../foundations/size_observer.js';
import { SymbolIcon } from '../foundations/symbol_icon.js';
import { layoutNotebookPageTabs, type NotebookPageTabPlacement } from './notebook_page_tab_layout.js';

export type CatalogTab = 'relations' | 'functions';

interface SortablePageTabProps {
    folderName: string;
    tabId: string;
    label: string;
    placement: NotebookPageTabPlacement | null;
    isStacked: boolean;
    isSelected: boolean;
    isEditing: boolean;
    editingPageTitle: string;
    editInputRef: React.RefObject<HTMLInputElement | null>;
    onSelect: () => void;
    onStartEditing: (event: React.MouseEvent) => void;
    onEditingTitleChange: (value: string) => void;
    onSavePageEdit: () => void;
    onEditKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}

/// A single sortable page card. In stacked mode only the selected card is draggable, while every
/// card remains a droppable target and a keyboard/pointer selection target.
const SortablePageTab: React.FC<SortablePageTabProps> = (props) => {
    const PencilIcon = SymbolIcon('pencil_16');
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: props.folderName,
        disabled: props.isEditing,
    });
    const layoutTransition = 'left 140ms ease, width 140ms ease';
    const style: React.CSSProperties = {
        left: props.placement?.left,
        width: props.placement?.width,
        transform: CSS.Transform.toString(transform),
        transition: transition ? `${transition}, ${layoutTransition}` : layoutTransition,
        zIndex: isDragging ? 1000 : props.placement?.zIndex,
        opacity: isDragging ? 0.8 : undefined,
    };
    const className = props.isSelected ? styles.page_tab_selected : styles.page_tab;
    return (
        <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            {...listeners}
            className={className}
            role="tab"
            id={props.tabId}
            aria-controls="notebook-body"
            aria-selected={props.isSelected}
            aria-disabled={undefined}
            aria-label={props.label}
            tabIndex={0}
            data-folder-name={props.folderName}
            data-side={props.placement?.side}
            onKeyDown={(event) => {
                if (!props.isSelected && event.key === 'Enter') {
                    event.preventDefault();
                    props.onSelect();
                    return;
                }
                listeners?.onKeyDown?.(event);
            }}
            onClick={() => {
                if (!props.isEditing) props.onSelect();
            }}
        >
            {props.isStacked && props.placement?.side !== 'selected' && (
                <span className={styles.page_stack_dot} aria-hidden="true" />
            )}
            <div className={styles.page_tab_button}>
                {props.isEditing ? (
                    <input
                        ref={props.editInputRef}
                        type="text"
                        aria-label="Page name"
                        className={styles.page_tab_input}
                        value={props.editingPageTitle}
                        onChange={(event) => props.onEditingTitleChange(event.target.value)}
                        onBlur={props.onSavePageEdit}
                        onKeyDown={props.onEditKeyDown}
                        onClick={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                    />
                ) : (
                    <>
                        <span className={styles.page_tab_label}>{props.label}</span>
                        <div className={styles.page_tab_actions}>
                            <IconButton
                                variant={ButtonVariant.Invisible}
                                size={ButtonSize.Tiny}
                                aria-label={`Rename ${props.label} page`}
                                onClick={props.onStartEditing}
                                onPointerDown={(event) => event.stopPropagation()}
                                className={styles.page_tab_action_button}
                            >
                                <PencilIcon size={12} />
                            </IconButton>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export interface NotebookPageTabsProps {
    folders: string[];
    getLabel: (folderName: string) => string;
    selectedFolderName: string;
    editingFolder: string | null;
    editingPageTitle: string;
    editInputRef: React.RefObject<HTMLInputElement | null>;
    catalogTab: CatalogTab | null;
    showCatalogTabs: boolean;
    onSelectPage: (folderName: string) => void;
    onAddPage: () => void;
    onSelectCatalog: (tab: CatalogTab) => void;
    onReorderPages: (event: DragEndEvent) => void;
    onStartEditing: (folderName: string, label: string, event: React.MouseEvent) => void;
    onEditingTitleChange: (value: string) => void;
    onSavePageEdit: () => void;
    onEditKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}

const MIN_CARD_WIDTH = 64;
const MAX_CARD_WIDTH = 220;
const EDITING_CARD_WIDTH = 168;
const STACK_NAV_WIDTH = 56;

export const NotebookPageTabs: React.FC<NotebookPageTabsProps> = (props) => {
    const ChevronLeftIcon = SymbolIcon('chevron_left_12');
    const ChevronRightIcon = SymbolIcon('chevron_right_12');
    const PlusIcon = SymbolIcon('plus_16');
    const pagesRef = React.useRef<HTMLDivElement>(null);
    const measurementRefs = React.useRef(new Map<string, HTMLDivElement>());
    const pagesSize = observeSize(pagesRef);
    const [naturalWidths, setNaturalWidths] = React.useState<number[]>([]);

    const dndSensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );

    React.useLayoutEffect(() => {
        const next = props.folders.map((folderName) => {
            const measured = measurementRefs.current.get(folderName)?.getBoundingClientRect().width ?? MIN_CARD_WIDTH;
            const editingWidth = props.editingFolder === folderName ? EDITING_CARD_WIDTH : 0;
            return Math.max(MIN_CARD_WIDTH, Math.min(MAX_CARD_WIDTH, measured), editingWidth);
        });
        setNaturalWidths((current) => (
            current.length === next.length && current.every((width, index) => width === next[index])
                ? current
                : next
        ));
    }, [props.folders, props.getLabel, props.editingFolder]);

    const selectedIndex = Math.max(0, props.folders.indexOf(props.selectedFolderName));
    let layout = naturalWidths.length === props.folders.length && pagesSize != null
        ? layoutNotebookPageTabs(pagesSize.width, naturalWidths, selectedIndex)
        : null;
    if (layout?.stacked) {
        layout = layoutNotebookPageTabs(Math.max(0, pagesSize!.width - STACK_NAV_WIDTH), naturalWidths, selectedIndex);
    }

    return (
        <div className={styles.page_tabs} role="tablist" aria-label="Notebook pages">
            <div ref={pagesRef} className={styles.page_tabs_pages}>
                {layout?.stacked && (
                    <button
                        type="button"
                        className={styles.page_stack_nav}
                        aria-label="Previous notebook page"
                        disabled={selectedIndex <= 0}
                        onClick={() => props.onSelectPage(props.folders[selectedIndex - 1])}
                    >
                        <ChevronLeftIcon size={12} />
                    </button>
                )}
                <div
                    className={styles.page_tabs_viewport}
                    data-stacked={layout?.stacked || undefined}
                >
                    <div className={styles.page_tabs_measurements} aria-hidden="true">
                        {props.folders.map((folderName) => {
                            const label = props.getLabel(folderName);
                            return (
                                <div
                                    key={folderName}
                                    ref={(node) => {
                                        if (node) measurementRefs.current.set(folderName, node);
                                        else measurementRefs.current.delete(folderName);
                                    }}
                                    className={styles.page_tab_measurement}
                                >
                                    <span>{label}</span>
                                    {props.catalogTab == null && folderName === props.selectedFolderName && <span className={styles.page_tab_action_measurement} />}
                                </div>
                            );
                        })}
                    </div>
                    <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={props.onReorderPages}>
                        <SortableContext items={props.folders} strategy={horizontalListSortingStrategy}>
                            {props.folders.map((folderName, index) => {
                                const label = props.getLabel(folderName);
                                return (
                                    <SortablePageTab
                                        key={folderName}
                                        folderName={folderName}
                                        tabId={`notebook-page-tab-${index}`}
                                        label={label}
                                        placement={layout?.placements[index] ?? null}
                                        isStacked={layout?.stacked ?? false}
                                        isSelected={props.catalogTab == null && folderName === props.selectedFolderName}
                                        isEditing={props.editingFolder === folderName}
                                        editingPageTitle={props.editingPageTitle}
                                        editInputRef={props.editInputRef}
                                        onSelect={() => props.onSelectPage(folderName)}
                                        onStartEditing={(event) => props.onStartEditing(folderName, label, event)}
                                        onEditingTitleChange={props.onEditingTitleChange}
                                        onSavePageEdit={props.onSavePageEdit}
                                        onEditKeyDown={props.onEditKeyDown}
                                    />
                                );
                            })}
                        </SortableContext>
                    </DndContext>
                </div>
                {layout?.stacked && (
                    <button
                        type="button"
                        className={styles.page_stack_nav}
                        aria-label="Next notebook page"
                        disabled={selectedIndex >= props.folders.length - 1}
                        onClick={() => props.onSelectPage(props.folders[selectedIndex + 1])}
                    >
                        <ChevronRightIcon size={12} />
                    </button>
                )}
            </div>
            <div className={styles.page_tabs_controls}>
                <button
                    type="button"
                    className={styles.page_tab_add}
                    aria-label="Add page"
                    onClick={props.onAddPage}
                >
                    <PlusIcon size={16} />
                </button>
                {props.showCatalogTabs && (
                    <button
                        type="button"
                        id="notebook-catalog-tab-relations"
                        role="tab"
                        aria-controls="notebook-body"
                        aria-selected={props.catalogTab === 'relations'}
                        aria-label="Relations"
                        className={props.catalogTab === 'relations' ? styles.catalog_tab_selected : styles.catalog_tab}
                        onClick={() => props.onSelectCatalog('relations')}
                    >
                        <span className={styles.page_tab_button}>
                            <span className={styles.catalog_tab_label_long}>relations</span>
                            <span className={styles.catalog_tab_label_short} aria-hidden="true">rel</span>
                        </span>
                    </button>
                )}
                {props.showCatalogTabs && (
                    <button
                        type="button"
                        id="notebook-catalog-tab-functions"
                        role="tab"
                        aria-controls="notebook-body"
                        aria-selected={props.catalogTab === 'functions'}
                        aria-label="Functions"
                        className={props.catalogTab === 'functions' ? styles.functions_tab_selected : styles.functions_tab}
                        onClick={() => props.onSelectCatalog('functions')}
                    >
                        <span className={styles.page_tab_button}>
                            <span className={styles.catalog_tab_label_long}>functions</span>
                            <span className={styles.catalog_tab_label_short} aria-hidden="true">fns</span>
                        </span>
                    </button>
                )}
            </div>
        </div>
    );
};

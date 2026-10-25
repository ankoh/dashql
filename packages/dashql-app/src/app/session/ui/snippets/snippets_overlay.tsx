import * as React from 'react';
import * as dashql from '@ankoh/dashql-core';

import type { EditorView } from '@codemirror/view';

import { AnchorAlignment, AnchorSide } from '../../../../ui/foundations/anchored_position.js';
import { AnchoredOverlay } from '../../../../ui/foundations/anchored_overlay.js';
import { Button, ButtonSize, ButtonVariant, IconButton } from '../../../../ui/foundations/button.js';
import { OverlaySize } from '../../../../ui/foundations/overlay.js';
import { DatabaseIcon, FileIcon, LibraryIcon, SearchIcon, XIcon } from '../../../../ui/foundations/symbol_icon.js';
import { TreeEntry, TreeEntryName } from '../../../../ui/foundations/tree_entry.js';
import { ConnectorType } from '../../../connections/connector_info.js';
import { useDashQLCoreSetup } from '../../../providers/core_provider.js';
import { ReadonlySqlView, useProjectedSqlText } from '../../scripts/editor/readonly_sql_view.js';
import { createScriptFormatConfig, formattingDialectForConnector, getKeywordCase, measureScriptFormatWidth } from '../script_format.js';
import { useAppConfig } from '../../../config/app_config.js';
import { SNIPPET_DATASETS_FOLDER, type Snippet } from '../../snippets/snippet.js';
import { getBundledSnippets, snippetText, snippetsForConnector, type SnippetRegistry } from '../../snippets/snippet_registry.js';
import * as styles from './snippets_overlay.module.css';

export interface SnippetsOverlayProps {
    /// The name of the script, for the labels of the trigger
    scriptName: string;
    /// The connector of the script, the browser shows the snippets that run on it
    connectorType: ConnectorType;
    /// Disable the trigger, e.g. while a rewrite of the script is pending
    disabled?: boolean;
    /// Replace the text of the script with the text of a snippet
    onApply: (text: string) => void;
    /// The snippets to browse, the bundled ones by default
    registry?: SnippetRegistry;
    /// The test id of the trigger
    testId?: string;
}

/// The registry while the bundled snippets are parsed
const EMPTY_REGISTRY: SnippetRegistry = { snippets: [], byId: new Map(), errors: [] };

/// The snippets of one category folder
interface SnippetFolder {
    /// The category, the name of the folder
    category: string;
    /// The snippets in the folder
    snippets: Snippet[];
}

/// The bundled snippets once the core is set up, null until then
function useBundledSnippets(): SnippetRegistry | null {
    const coreSetup = useDashQLCoreSetup();
    const [registry, setRegistry] = React.useState<SnippetRegistry | null>(null);
    React.useEffect(() => {
        if (coreSetup == null) return;
        let cancelled = false;
        coreSetup('snippets').then(core => {
            if (!cancelled) setRegistry(getBundledSnippets(core));
        });
        return () => { cancelled = true; };
    }, [coreSetup]);
    return registry;
}

/// A library button that opens a browser of SQL snippets, applying a snippet replaces the text of the script
export function SnippetsOverlay(props: SnippetsOverlayProps): React.ReactElement {
    const anchorRef = React.useRef<HTMLButtonElement>(null);
    const listRef = React.useRef<HTMLDivElement>(null);
    const [open, setOpen] = React.useState(false);
    const apply = React.useCallback((text: string) => {
        setOpen(false);
        props.onApply(text);
    }, [props.onApply]);

    return (
        <>
            <IconButton
                ref={anchorRef}
                variant={open ? ButtonVariant.Default : ButtonVariant.Invisible}
                size={ButtonSize.Small}
                aria-label={`Insert a snippet into ${props.scriptName}`}
                aria-haspopup="dialog"
                aria-expanded={open}
                data-testid={props.testId ?? 'script-snippets'}
                disabled={props.disabled}
                onClick={(event) => { event.stopPropagation(); setOpen(value => !value); }}
            >
                <LibraryIcon size={16} />
            </IconButton>
            <AnchoredOverlay
                renderAnchor={null}
                anchorRef={anchorRef}
                returnFocusRef={anchorRef}
                open={open}
                onClose={() => setOpen(false)}
                side={AnchorSide.OutsideBottom}
                align={AnchorAlignment.End}
                width={OverlaySize.XXL}
                height={OverlaySize.L}
                focusTrapSettings={{ initialFocusRef: listRef as React.RefObject<HTMLElement> }}
            >
                <SnippetBrowser
                    connectorType={props.connectorType}
                    registry={props.registry}
                    listRef={listRef}
                    onApply={apply}
                    onClose={() => setOpen(false)}
                />
            </AnchoredOverlay>
        </>
    );
}

interface SnippetBrowserProps {
    /// The connector of the script
    connectorType: ConnectorType;
    /// The snippets to browse, the bundled ones by default
    registry?: SnippetRegistry;
    /// The snippet list, focused when the browser opens
    listRef: React.RefObject<HTMLDivElement | null>;
    /// Apply the text of a snippet
    onApply: (text: string) => void;
    /// Close the browser
    onClose: () => void;
}

/// The content of the snippet overlay, mounted while the overlay is open
function SnippetBrowser(props: SnippetBrowserProps): React.ReactElement {
    const bundled = useBundledSnippets();
    const registry = props.registry ?? bundled ?? EMPTY_REGISTRY;
    const titleId = React.useId();
    const [selectedId, setSelectedId] = React.useState<string | null>(null);
    const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(new Set());

    // Only the snippets that run on the connection of the script, in the folders of their categories
    const snippets = React.useMemo(() => snippetsForConnector(registry, props.connectorType), [registry, props.connectorType]);
    const folders = React.useMemo(() => {
        const byCategory = new Map<string, SnippetFolder>();
        for (const snippet of snippets) {
            let folder = byCategory.get(snippet.category);
            if (folder == null) {
                folder = { category: snippet.category, snippets: [] };
                byCategory.set(snippet.category, folder);
            }
            folder.snippets.push(snippet);
        }
        return [...byCategory.values()];
    }, [snippets]);
    // The keys move through the snippets of the expanded folders
    const visible = React.useMemo(() => folders.flatMap(folder => collapsed.has(folder.category) ? [] : folder.snippets),
        [folders, collapsed]);
    const selected = snippets.find(snippet => snippet.id === selectedId) ?? visible[0] ?? null;
    const toggle = React.useCallback((category: string) => setCollapsed(current => {
        const next = new Set(current);
        if (!next.delete(category)) next.add(category);
        return next;
    }), []);
    const text = React.useMemo(() => selected == null ? '' : snippetText(selected, props.connectorType),
        [selected, props.connectorType]);
    // The preview formats the text to the width of the view, the applied text stays as written
    const keywordCase = getKeywordCase(useAppConfig()?.settings);
    const [formatWidth, setFormatWidth] = React.useState<number | null>(null);
    const onPreviewResize = React.useCallback((view: EditorView) => setFormatWidth(measureScriptFormatWidth(view)), []);
    const formatConfig = React.useMemo(() => formatWidth == null ? null : createScriptFormatConfig(
        dashql.buffers.formatting.FormattingMode.PRETTY, false, formatWidth, keywordCase, formattingDialectForConnector(props.connectorType),
    ), [formatWidth, keywordCase, props.connectorType]);
    const preview = useProjectedSqlText(text, 'snippets', formatConfig);

    const apply = React.useCallback(() => {
        if (selected != null) props.onApply(text);
    }, [selected, text, props.onApply]);

    // Arrow keys move the selection, Enter applies it
    const onListKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            apply();
            return;
        }
        if ((event.key !== 'ArrowDown' && event.key !== 'ArrowUp') || visible.length === 0) return;
        event.preventDefault();
        const index = selected == null ? -1 : visible.indexOf(selected);
        const next = visible[Math.min(Math.max(index + (event.key === 'ArrowDown' ? 1 : -1), 0), visible.length - 1)];
        setSelectedId(next.id);
        const item = props.listRef.current?.querySelector<HTMLElement>(`[data-snippet-id="${next.id}"]`);
        item?.focus();
        item?.scrollIntoView({ block: 'nearest' });
    }, [apply, visible, selected, props.listRef]);

    return (
        <section className={styles.overlay} role="dialog" aria-labelledby={titleId} data-testid="snippets-overlay">
            <header className={styles.header}>
                <h2 id={titleId}>Snippets</h2>
                <IconButton
                    variant={ButtonVariant.Invisible}
                    size={ButtonSize.Small}
                    aria-label="Close snippets"
                    data-testid="snippets-close"
                    onClick={props.onClose}
                >
                    <XIcon size={16} />
                </IconButton>
            </header>
            <div className={styles.body}>
                <div ref={props.listRef} className={styles.list} data-testid="snippet-list" tabIndex={-1} onKeyDown={onListKeyDown}>
                    {snippets.length === 0 ? (
                        <div className={styles.empty} data-testid="snippets-empty">No snippets for this connection.</div>
                    ) : (
                        <div className={styles.tree}>
                            {folders.map(folder => {
                                const expanded = !collapsed.has(folder.category);
                                return (
                                    <React.Fragment key={folder.category}>
                                        <TreeEntry
                                            depth={0}
                                            expanded={expanded}
                                            // The datasets load data, the snippets of the other folders query it
                                            icon={folder.category === SNIPPET_DATASETS_FOLDER ? <DatabaseIcon size={14} /> : <SearchIcon size={14} />}
                                            label={<TreeEntryName>{folder.category}</TreeEntryName>}
                                            data-testid="snippet-folder"
                                            data-folder={folder.category}
                                            onClick={() => toggle(folder.category)}
                                        />
                                        {expanded && folder.snippets.map(snippet => {
                                            const path = snippet.paths.get(props.connectorType)!;
                                            return (
                                                <TreeEntry
                                                    key={snippet.id}
                                                    depth={1}
                                                    icon={<FileIcon size={14} />}
                                                    label={<TreeEntryName title={path}>{path.slice(path.lastIndexOf('/') + 1)}</TreeEntryName>}
                                                    selected={snippet === selected}
                                                    data-testid="snippet"
                                                    data-snippet-id={snippet.id}
                                                    onClick={() => setSelectedId(snippet.id)}
                                                    onDoubleClick={() => props.onApply(snippetText(snippet, props.connectorType))}
                                                />
                                            );
                                        })}
                                    </React.Fragment>
                                );
                            })}
                        </div>
                    )}
                </div>
                <div className={styles.preview} data-testid="snippet-preview" data-snippet-id={selected?.id}>
                    {selected != null && (
                        <>
                            <div className={styles.preview_header}>
                                <div className={styles.preview_description} data-testid="snippet-description">{selected.description}</div>
                                <Button variant={ButtonVariant.Primary} size={ButtonSize.Small} data-testid="snippet-apply" onClick={apply}>
                                    Use
                                </Button>
                            </div>
                            <div className={styles.preview_text} data-testid="snippet-text">
                                <ReadonlySqlView text={preview.text} editorUpdate={preview.editorUpdate} onResize={onPreviewResize} />
                            </div>
                        </>
                    )}
                </div>
            </div>
        </section>
    );
}

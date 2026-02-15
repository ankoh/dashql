import * as React from 'react';
import * as styles from './notebook_page.module.css';
import * as core from '@ankoh/dashql-core';

import { EditorView } from '@codemirror/view';

import { Button, ButtonSize, ButtonVariant, IconButton } from '../foundations/button.js';
import { CatalogStatisticsOverlay } from '../catalog/catalog_statistics_overlay.js';
import { CatalogViewer } from '../catalog/catalog_viewer.js';
import { ConnectionState } from '../../connection/connection_state.js';
import { ScriptData, NotebookState } from '../../notebook/notebook_state.js';
import { ScriptEditor } from './notebook_editor.js';
import { SymbolIcon } from '../foundations/symbol_icon.js';
import { useScrollbarHeight, useScrollbarWidth } from '../../utils/scrollbar.js';

export enum PinState {
    Hide,
    ShowIfSpace,
    PinnedByUser,
    UnpinnedByUser,
}

export interface ScriptEditorWithCatalogProps {
    notebook: NotebookState;
    connection: ConnectionState | null;
    script: ScriptData;
}

export function ScriptEditorWithCatalog(props: ScriptEditorWithCatalogProps) {
    const CatalogIcon = SymbolIcon('workflow_16');
    const PinSlashIcon = SymbolIcon('pin_slash_16');
    const InfoCircleIcon = SymbolIcon('info_circle_16');

    const [pinState, setPinState] = React.useState<PinState>(PinState.Hide);
    const [view, setView] = React.useState<EditorView | null>(null);
    const [showCatalogStats, setShowCatalogStats] = React.useState<boolean>(false);
    const catalogOverlayRef = React.useRef<HTMLDivElement>(null);
    const scrollbarWidth = useScrollbarWidth();
    const scrollbarHeight = useScrollbarHeight();

    const [overlayMarginRight, overlayMarginBottom] = React.useMemo(() => {
        let marginRight = 0;
        let marginBottom = 0;
        if (props.script.cursor && view) {
            const hasVerticalScrollbar = view.scrollDOM.scrollHeight > view.scrollDOM.clientHeight;
            const hasHorizontalScrollbar = view.scrollDOM.scrollWidth > view.scrollDOM.clientWidth;
            marginRight = hasVerticalScrollbar ? scrollbarWidth : 0;
            marginBottom = hasHorizontalScrollbar ? scrollbarHeight : 0;
        }
        return [marginRight, marginBottom];
    }, [props.script.cursor, view, catalogOverlayRef.current]);

    React.useEffect(() => {
        if (props.script.cursor == null || props.script.cursor.read().contextType() == core.buffers.cursor.ScriptCursorContext.NONE) {
            if (pinState != PinState.PinnedByUser) {
                setPinState(PinState.Hide);
            }
        } else {
            if (pinState != PinState.PinnedByUser) {
                setPinState(PinState.ShowIfSpace);
            }
        }
    }, [props.script.cursor]);

    const showMinimap = pinState == PinState.PinnedByUser;
    return (
        <div className={styles.entry_card_tabs_body}>
            <ScriptEditor
                notebookId={props.notebook.notebookId}
                setView={setView}
            />
            <Button
                className={styles.catalog_overlay_bean}
                leadingVisual={CatalogIcon}
                onClick={() => setPinState(PinState.PinnedByUser)}
                size={ButtonSize.Medium}
                style={{ display: showMinimap ? 'none' : 'block' }}
            >
                Catalog
            </Button>
            {
                showMinimap && (
                    <div
                        className={styles.catalog_overlay_container}
                        ref={catalogOverlayRef}
                        style={{
                            right: overlayMarginRight,
                            bottom: overlayMarginBottom
                        }}
                    >
                        <div className={styles.catalog_overlay_content}>
                            <div className={styles.catalog_overlay_header}>
                                <div className={styles.catalog_overlay_header_icon}>
                                    <CatalogIcon size={14} />
                                </div>
                                <div className={styles.catalog_overlay_header_text}>
                                    Catalog
                                </div>
                                <div className={styles.catalog_overlay_header_info}>
                                    {props.connection && (
                                        <CatalogStatisticsOverlay
                                            anchorClassName={styles.catalog_overlay_header_info_anchor}
                                            connection={props.connection}
                                            isOpen={showCatalogStats}
                                            setIsOpen={setShowCatalogStats}
                                        />
                                    )}
                                    <IconButton
                                        className={styles.catalog_overlay_header_info_button}
                                        variant={ButtonVariant.Invisible}
                                        aria-label="info-overlay"
                                        onClick={() => setShowCatalogStats(true)}
                                    >
                                        <InfoCircleIcon size={14} />
                                    </IconButton>
                                </div>
                                <IconButton
                                    className={styles.catalog_overlay_header_button_unpin}
                                    variant={ButtonVariant.Invisible}
                                    aria-label="unpin-overlay"
                                    onClick={() => setPinState(PinState.UnpinnedByUser)}
                                >
                                    <PinSlashIcon size={14} />
                                </IconButton>
                            </div>
                            <div className={styles.catalog_viewer}>
                                <CatalogViewer notebookId={props.notebook.notebookId} />
                            </div>
                        </div>
                    </div>
                )
            }
        </div>
    );
}

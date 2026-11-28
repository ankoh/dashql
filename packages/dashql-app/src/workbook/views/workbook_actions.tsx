import * as React from 'react';
import * as styles from './workbook_views_page.module.css';
import * as actionMenuStyles from '../../app/action_menu.module.css';

import * as ActionList from '@akohn/dashql-react/components/action_list';
import { AnchoredOverlay } from '@akohn/dashql-react/components/anchored_overlay';
import { Button, ButtonSize, ButtonVariant, IconButton } from '@akohn/dashql-react/components/button';
import { LinkIcon, PaperclipIcon, SymbolIcon } from '@akohn/dashql-react/components/symbol_icon';
import { AnchorAlignment, AnchorSide } from '@akohn/dashql-react/dom/anchored_position';
import { classNames } from '@akohn/dashql-react/dom/classnames';
import { ATTACHMENT_EXTENSION } from '@akohn/dashql/platform/storage/storage_backend';
import type { WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';
import { CloudPreviewActions } from '../../cloud/cloud_preview_actions.js';
import { useAppFlavor } from '../../config/flavor_provider.js';
import { WorkbookFileSaveOverlay } from '../persistence/workbook_file_save_overlay.js';
import { WorkbookURLShareOverlay } from '../persistence/workbook_url_share_overlay.js';

const FileZipIcon = SymbolIcon('file_zip_16');
const MoreIcon = SymbolIcon('kebab_horizontal');

/// The files that the workbook attaches, picked in the menu
export interface WorkbookAttach {
    /// Does the workbook take attachments now? Its connection reads them and it isn't read-only.
    enabled: boolean;
    /// Attach the picked files
    attach: (files: File[]) => void;
}

interface Props {
    workbookScripts: WorkbookScripts;
    /// Is the workbook the ephemeral workbook of the greeter? It has nothing to share.
    ephemeral: boolean;
    /// Is the workbook a read-only look at a published one? It has the actions of the preview.
    preview: boolean;
    /// Attach files from the menu, null while attachments are hidden
    attach: WorkbookAttach | null;
}

/// The group of the actions of a workbook in the bar: the actions of a preview, Export .dashql and the menu with Share
/// as URL, Export .dashql and Attach File. Share as URL opens at the menu button, Export .dashql at the button that
/// opened it.
export function WorkbookActions(props: Props): React.ReactElement {
    const { workbookScripts, ephemeral, preview, attach } = props;
    const menuTriggerRef = React.useRef<HTMLButtonElement>(null);
    const exportTriggerRef = React.useRef<HTMLButtonElement>(null);
    const attachInputRef = React.useRef<HTMLInputElement>(null);
    const [menuOpen, setMenuOpen] = React.useState(false);
    const [shareOpen, setShareOpen] = React.useState(false);
    const [exportOpen, setExportOpen] = React.useState<'button' | 'menu' | null>(null);
    const setExportOverlayOpen = React.useCallback((open: boolean) => setExportOpen(current => open ? current ?? 'button' : null), []);
    const flavor = useAppFlavor();
    const archiveExport = flavor.features.workbookArchiveExport;
    // The DashQL flavor also shows Export .dashql next to the menu
    const exportButton = archiveExport && flavor.id === 'dashql';
    const ownActions = !ephemeral && !preview;
    return (
        <div className={classNames(styles.bar_group, styles.actions_group)} role="group" aria-label="Actions" data-testid="workbook-actions-group">
            {preview && <CloudPreviewActions workbookId={workbookScripts.workbookId} labelClassName={styles.action_label} />}
            {exportButton && ownActions && (
                <Button ref={exportTriggerRef} size={ButtonSize.Small} variant={ButtonVariant.Invisible} leadingVisual={FileZipIcon} aria-label="Export .dashql" data-testid="export-workbook" aria-expanded={exportOpen === 'button'} onClick={() => {
                    setShareOpen(false);
                    setExportOpen(value => value === 'button' ? null : 'button');
                }}>
                    <span className={styles.action_label}>Export .dashql</span>
                </Button>
            )}
            {ownActions && (
                <AnchoredOverlay
                    open={menuOpen}
                    onOpen={() => setMenuOpen(true)}
                    onClose={() => setMenuOpen(false)}
                    side={AnchorSide.OutsideBottom}
                    align={AnchorAlignment.End}
                    anchorOffset={4}
                    anchorRef={menuTriggerRef}
                    returnFocusRef={menuTriggerRef}
                    renderAnchor={anchorProps => (
                        <IconButton {...anchorProps} ref={menuTriggerRef} size={ButtonSize.Small} variant={ButtonVariant.Invisible}
                            aria-label="More workbook actions" data-testid="workbook-actions">
                            <MoreIcon size={16} />
                        </IconButton>
                    )}
                >
                    <div className={actionMenuStyles.menu} role="dialog" aria-label="Workbook actions">
                        <ActionList.List aria-label="Workbook actions">
                            <ActionList.ListItem data-testid="workbook-action" data-action="share-url" onClick={() => {
                                setMenuOpen(false);
                                setExportOpen(null);
                                setShareOpen(true);
                            }}>
                                <ActionList.Leading><LinkIcon size={16} /></ActionList.Leading>
                                <ActionList.ItemText>Share as URL</ActionList.ItemText>
                            </ActionList.ListItem>
                            {/* The list takes elements only, the fragments wrap the optional items */}
                            <>{archiveExport && (
                                <ActionList.ListItem data-testid="workbook-action" data-action="export" onClick={() => {
                                    setMenuOpen(false);
                                    setShareOpen(false);
                                    setExportOpen('menu');
                                }}>
                                    <ActionList.Leading><FileZipIcon size={16} /></ActionList.Leading>
                                    <ActionList.ItemText>Export .dashql</ActionList.ItemText>
                                </ActionList.ListItem>
                            )}</>
                            <>{attach != null && (
                                <ActionList.ListItem data-testid="workbook-action" data-action="attach" disabled={!attach.enabled} onClick={() => {
                                    setMenuOpen(false);
                                    attachInputRef.current?.click();
                                }}>
                                    <ActionList.Leading><PaperclipIcon size={16} /></ActionList.Leading>
                                    <ActionList.ItemText>Attach File</ActionList.ItemText>
                                </ActionList.ListItem>
                            )}</>
                        </ActionList.List>
                    </div>
                </AnchoredOverlay>
            )}
            <WorkbookURLShareOverlay workbookId={workbookScripts.workbookId} isOpen={shareOpen} setIsOpen={setShareOpen} anchorRef={menuTriggerRef} />
            {archiveExport && ownActions && (
                <WorkbookFileSaveOverlay
                    isOpen={exportOpen != null}
                    setIsOpen={setExportOverlayOpen}
                    anchorRef={exportOpen === 'button' ? exportTriggerRef : menuTriggerRef}
                    workbookScripts={workbookScripts}
                    fileName={workbookScripts.name ?? workbookScripts.workbookMetadata.originalFileName ?? 'workbook'}
                />
            )}
            {attach != null && (
                <input ref={attachInputRef} className={styles.attach_input} type="file" multiple accept={ATTACHMENT_EXTENSION}
                    aria-label="Attach files to the workbook" disabled={!attach.enabled} onChange={event => {
                        const files = event.target.files == null ? [] : Array.from(event.target.files);
                        event.target.value = '';
                        if (files.length > 0) attach.attach(files);
                    }} />
            )}
        </div>
    );
}

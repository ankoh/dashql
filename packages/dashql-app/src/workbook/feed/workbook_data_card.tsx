import * as React from 'react';
import * as styles from './workbook_feed.module.css';
import type { ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import type * as dashql from '@akohn/dashql';
import type { StorageReader } from '../../storage/storage_provider.js';
import { useFileDownloader } from '../../platform/file/file_downloader_hook.js';
import { useLogger } from '../../platform/logger_provider.js';
import { stringifyError } from '@akohn/dashql/platform/logger/logger';
import { ButtonSize, ButtonVariant, IconButton } from '@akohn/dashql-react/components/button';
import { DownloadIcon, FileIcon, PencilIcon, TrashIcon } from '@akohn/dashql-react/components/symbol_icon';
import { ScriptMentionTag } from './script_mention_tag.js';
import { formatBytes } from '@akohn/dashql-react/format/format';
import { useWorkbookReadOnly } from '../workbook_read_only.js';

export interface WorkbookDataCardProps {
    workbookId: string;
    /// The attachment as the view of the workbook lists it
    attachment: Pick<dashql.WorkbookAttachmentView, 'fileName' | 'name' | 'sizeBytes'>;
    conn: ConnectionState | null;
    storageReader: StorageReader;
    onRemoved: () => void;
    /// Insert the table parameter of the attachment, `:sales`, where the user last wrote
    onMention?: (name: string) => void;
    /// Rename the attachment, the name is the new name of its table parameter
    onRename?: (name: string) => void;
    /// Is the name of the table parameter the name of a script too? A table parameter with the name is ambiguous.
    collides?: boolean;
}

export const WorkbookDataCard: React.FC<WorkbookDataCardProps> = (props) => {
    const downloader = useFileDownloader();
    const logger = useLogger();
    const [busy, setBusy] = React.useState(false);
    // A read-only workbook keeps its attachments
    const readOnly = useWorkbookReadOnly();
    const [renaming, setRenaming] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const enabled = props.conn?.readsAttachments ?? false;
    const disabled = !enabled || busy;
    // An attachment is the table parameter of its name, scripts read `sales.parquet` as `:sales`
    const parameter = props.attachment.name;
    const fileName = props.attachment.fileName;

    const download = async () => {
        if (disabled) return;
        setBusy(true);
        setError(null);
        try {
            const bytes = await props.storageReader.backend.loadDataFile(props.workbookId, fileName);
            await downloader.downloadBufferAsFile(bytes, fileName);
        } catch (e) {
            setError('Downloading data file failed');
            logger.error('Downloading data file failed', { error: stringifyError(e) }, 'workbook_data_card');
        } finally {
            setBusy(false);
        }
    };
    const remove = async () => {
        if (disabled) return;
        setBusy(true);
        setError(null);
        try {
            await props.storageReader.backend.deleteDataFile(props.workbookId, fileName);
            props.onRemoved();
        } catch (e) {
            setError('Removing data file failed');
            logger.error('Removing data file failed', { error: stringifyError(e) }, 'workbook_data_card');
        } finally {
            setBusy(false);
        }
    };

    return (
        <article className={styles.feed_data_card} aria-label={`${fileName} attachment`} data-electron-drag-region="false">
            <div className={styles.feed_data_card_topline}>
                <div className={styles.feed_data_file_icon} aria-hidden="true" data-testid="data-file-type">
                    <FileIcon size={24} />
                    <span>PARQUET</span>
                </div>
                <div className={styles.feed_data_title}>
                    <span className={styles.feed_data_name}>{fileName}</span>
                    <span className={styles.feed_data_size}>{formatBytes(props.attachment.sizeBytes)}</span>
                </div>
                <div className={styles.feed_data_actions}>
                    {/* The table parameter of the attachment, mentioned and renamed like a script */}
                    <ScriptMentionTag
                        scriptName={parameter}
                        subject="attachment"
                        canTarget={!disabled && !readOnly && props.onMention != null}
                        onTarget={() => props.onMention?.(parameter)}
                        renaming={renaming}
                        onRenamingChange={setRenaming}
                        onRename={name => props.onRename?.(name)}
                    />
                    {props.onRename != null && !readOnly && (
                        <IconButton variant={ButtonVariant.Invisible} size={ButtonSize.Medium} disabled={disabled}
                            // The input takes the focus, a click while it is open keeps the edit
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => setRenaming(true)} aria-label={`Rename ${fileName}`} data-testid="data-file-rename">
                            <PencilIcon size={16} />
                        </IconButton>
                    )}
                    <IconButton variant={ButtonVariant.Invisible} size={ButtonSize.Medium}
                        disabled={disabled} onClick={download} aria-label={`Download ${fileName}`} data-testid="data-file-download">
                        <DownloadIcon size={16} />
                    </IconButton>
                    {!readOnly && <IconButton variant={ButtonVariant.Invisible} size={ButtonSize.Medium}
                        disabled={disabled} onClick={remove} aria-label={`Remove ${fileName}`} data-testid="data-file-remove">
                        <TrashIcon size={16} />
                    </IconButton>}
                </div>
            </div>
            {props.collides && (
                <div role="status" data-testid="data-file-collision">A script is named {parameter} too, :{parameter} is ambiguous</div>
            )}
            {error != null && <div role="alert">{error}</div>}
        </article>
    );
};

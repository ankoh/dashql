import * as React from 'react';
import * as styles from './session_feed.module.css';
import type { ConnectionState } from '../../connections/connection_state.js';
import { connectionReadsAttachments } from '../../connections/connector_descriptor.js';
import type { DataFile } from '../../storage/storage_backend.js';
import type { StorageReader } from '../../storage/storage_provider.js';
import { useFileDownloader } from '../../platform/file/file_downloader_hook.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { stringifyError } from '../../platform/logger/logger.js';
import { ButtonSize, ButtonVariant, IconButton } from '../../ui/foundations/button.js';
import { DownloadIcon, FileIcon, PencilIcon, TrashIcon } from '../../ui/foundations/symbol_icon.js';
import { ScriptMentionTag } from './script_mention_tag.js';
import { formatBytes } from '../../utils/format.js';
import { attachmentParameterName } from '../attachments/session_attachments.js';

export interface SessionDataCardProps {
    sessionId: string;
    file: DataFile;
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

export const SessionDataCard: React.FC<SessionDataCardProps> = (props) => {
    const downloader = useFileDownloader();
    const logger = useLogger();
    const [busy, setBusy] = React.useState(false);
    const [renaming, setRenaming] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const enabled = connectionReadsAttachments(props.conn?.details);
    const disabled = !enabled || busy;
    // An attachment is the table parameter of its name, scripts read `sales.parquet` as `:sales`
    const parameter = attachmentParameterName(props.file.name) ?? props.file.name;

    const download = async () => {
        if (disabled) return;
        setBusy(true);
        setError(null);
        try {
            const bytes = await props.storageReader.backend.loadDataFile(props.sessionId, props.file.name);
            await downloader.downloadBufferAsFile(bytes, props.file.name);
        } catch (e) {
            setError('Downloading data file failed');
            logger.error('Downloading data file failed', { error: stringifyError(e) }, 'session_data_card');
        } finally {
            setBusy(false);
        }
    };
    const remove = async () => {
        if (disabled) return;
        setBusy(true);
        setError(null);
        try {
            await props.storageReader.backend.deleteDataFile(props.sessionId, props.file.name);
            props.onRemoved();
        } catch (e) {
            setError('Removing data file failed');
            logger.error('Removing data file failed', { error: stringifyError(e) }, 'session_data_card');
        } finally {
            setBusy(false);
        }
    };

    return (
        <article className={styles.feed_data_card} aria-label={`${props.file.name} attachment`} data-electron-drag-region="false">
            <div className={styles.feed_data_card_topline}>
                <div className={styles.feed_data_file_icon} aria-hidden="true" data-testid="data-file-type">
                    <FileIcon size={24} />
                    <span>PARQUET</span>
                </div>
                <div className={styles.feed_data_title}>
                    <span className={styles.feed_data_name}>{props.file.name}</span>
                    <span className={styles.feed_data_size}>{formatBytes(props.file.sizeBytes)}</span>
                </div>
                <div className={styles.feed_data_actions}>
                    {/* The table parameter of the attachment, mentioned and renamed like a script */}
                    <ScriptMentionTag
                        scriptName={parameter}
                        subject="attachment"
                        canTarget={!disabled && props.onMention != null}
                        onTarget={() => props.onMention?.(parameter)}
                        renaming={renaming}
                        onRenamingChange={setRenaming}
                        onRename={name => props.onRename?.(name)}
                    />
                    {props.onRename != null && (
                        <IconButton variant={ButtonVariant.Invisible} size={ButtonSize.Medium} disabled={disabled}
                            // The input takes the focus, a click while it is open keeps the edit
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => setRenaming(true)} aria-label={`Rename ${props.file.name}`} data-testid="data-file-rename">
                            <PencilIcon size={16} />
                        </IconButton>
                    )}
                    <IconButton variant={ButtonVariant.Invisible} size={ButtonSize.Medium}
                        disabled={disabled} onClick={download} aria-label={`Download ${props.file.name}`} data-testid="data-file-download">
                        <DownloadIcon size={16} />
                    </IconButton>
                    <IconButton variant={ButtonVariant.Invisible} size={ButtonSize.Medium}
                        disabled={disabled} onClick={remove} aria-label={`Remove ${props.file.name}`} data-testid="data-file-remove">
                        <TrashIcon size={16} />
                    </IconButton>
                </div>
            </div>
            {props.collides && (
                <div role="status" data-testid="data-file-collision">A script is named {parameter} too, :{parameter} is ambiguous</div>
            )}
            {error != null && <div role="alert">{error}</div>}
        </article>
    );
};

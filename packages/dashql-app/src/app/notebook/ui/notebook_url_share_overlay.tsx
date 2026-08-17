import * as React from 'react';

import * as styles from './notebook_url_share_overlay.module.css';

import { CheckIcon, PaperclipIcon } from '@primer/octicons-react';

import { AnchorAlignment } from '../../../ui/foundations/anchored_position.js';
import { AnchoredOverlay } from '../../../ui/foundations/anchored_overlay.js';
import { IconButton } from '../../../ui/foundations/button.js';
import { TextInput } from '../../../ui/foundations/text_input.js';
import { NotebookExportSettings, NotebookExportSettingsView } from './notebook_export_settings_view.js';
import { classNames } from '../../../utils/classnames.js';
import { exportNotebookAsUrl, NotebookLinkTarget } from '../persistence/notebook_export.js';
import { connectionParamsHaveLoginHint, getConnectionParamsFromStateDetails } from '../connections/connection_params.js';
import { sleep } from '../../../utils/sleep.js';
import { useConnectionState } from '../connections/connection_registry.js';
import { useRouteContext } from '../../router/router.js';
import { useNotebookScripts } from '../scripts/notebook_scripts_registry.js';
import { useStorageReader } from '../persistence/storage_provider.js';

const COPY_CHECKMARK_DURATION_MS = 1000;

interface Props {
    className?: string;
    isOpen: boolean;
    setIsOpen: (v: boolean) => void;
}

interface State {
    publicURLText: string | null;
    copyStartedAt: Date | null;
    copyFinishedAt: Date | null;
    copyError: any | null;
    uiResetAt: Date | null;
}

export const NotebookURLShareOverlay: React.FC<Props> = (props: Props) => {
    const route = useRouteContext();
    const anchorRef = React.createRef<HTMLDivElement>();
    const buttonRef = React.createRef<HTMLButtonElement>();

    const [notebookScripts] = useNotebookScripts(route.notebookId ?? null);
    const [connection, _modifyConnection] = useConnectionState(notebookScripts?.notebookId ?? null);
    const storage = useStorageReader();
    const [state, setState] = React.useState<State>(() => ({
        publicURLText: null,
        copyStartedAt: null,
        copyFinishedAt: null,
        copyError: null,
        uiResetAt: null,
    }));
    const [settings, setSettings] = React.useState<NotebookExportSettings>({
        withCatalog: false,
        withLoginHint: true,
    });

    React.useEffect(() => {
        if (!props.isOpen) {
            return;
        }

        let cancelled = false;

        async function generateURL() {
            let setupUrl: URL | null = null;
            if (notebookScripts != null && connection != null) {
                const conn = getConnectionParamsFromStateDetails(connection.details);
                if (conn) {
                    setupUrl = await exportNotebookAsUrl(storage.backend, notebookScripts.notebookId, conn, NotebookLinkTarget.WEB, settings.withLoginHint);
                }
            }

            if (!cancelled) {
                setState({
                    publicURLText: setupUrl?.toString() ?? null,
                    copyStartedAt: null,
                    copyFinishedAt: null,
                    copyError: null,
                    uiResetAt: null,
                });
            }
        }

        generateURL();

        return () => {
            cancelled = true;
        };
    }, [settings, notebookScripts, connection, props.isOpen]);

    // Copy the url to the clipboard
    const copyURL = React.useCallback(
        (event: React.MouseEvent) => {
            if (!state.publicURLText) return;
            event.stopPropagation();
            const urlText = state.publicURLText;
            setState(s => ({
                ...s,
                copyStartedAt: new Date(),
                copyFinishedAt: null,
                copyError: null,
                uiResetAt: null,
            }));
            const copy = async () => {
                try {
                    await navigator.clipboard.writeText(urlText);
                    setState(s => ({
                        ...s,
                        copyFinishedAt: new Date(),
                        copyError: null,
                    }));
                } catch (e: any) {
                    setState(s => ({
                        ...s,
                        copyFinishedAt: new Date(),
                        copyError: e,
                    }));
                }
                await sleep(COPY_CHECKMARK_DURATION_MS);
                setState(s => ({
                    ...s,
                    uiResetAt: new Date(),
                }));
            };
            copy();
        },
        [state, setState],
    );

    const hasLoginHint = React.useMemo(
        () => connection != null && connectionParamsHaveLoginHint(getConnectionParamsFromStateDetails(connection.details)),
        [connection],
    );

    const ButtonIcon = state.copyFinishedAt != null && state.uiResetAt == null ? CheckIcon : PaperclipIcon;
    return (
        <AnchoredOverlay
            renderAnchor={() => <div ref={anchorRef} />}
            open={props.isOpen}
            onClose={() => props.setIsOpen(false)}
            anchorRef={anchorRef}
            align={AnchorAlignment.End}
            overlayProps={{
                initialFocusRef: buttonRef,
            }}
        >
            <div className={classNames(styles.sharing_overlay, props.className)}>
                <div className={styles.sharing_url}>
                    <TextInput disabled={true} value={state.publicURLText ?? ''} />
                    <IconButton
                        ref={buttonRef}
                        onClick={copyURL}
                        aria-labelledby="copy-to-clipboard"
                        aria-label="Copy to Clipboard"
                    >
                        <ButtonIcon />
                    </IconButton>
                    <div className={styles.sharing_url_stats}>{state.publicURLText?.length ?? 0} characters</div>
                </div>
                <NotebookExportSettingsView
                    withCatalog={false}
                    withLoginHint={hasLoginHint}
                    settings={settings}
                    setSettings={setSettings}
                />
            </div>
        </AnchoredOverlay>
    );
};

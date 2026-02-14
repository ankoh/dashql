import * as React from 'react';

import * as styles from './notebook_url_share_overlay.module.css';

import { Box } from '@primer/react';
import { CheckIcon, PaperclipIcon } from '@primer/octicons-react';

import { AnchorAlignment } from '../foundations/anchored_position.js';
import { AnchoredOverlay } from '../foundations/anchored_overlay.js';
import { IconButton } from '../../view/foundations/button.js';
import { TextInput } from '../foundations/text_input.js';
import { NotebookExportSettings, NotebookExportSettingsView } from './notebook_export_settings_view.js';
import { classNames } from '../../utils/classnames.js';
import { encodeNotebookAsProto, encodeNotebookProtoAsUrl, NotebookLinkTarget } from '../../notebook/notebook_export.js';
import { getConnectionParamsFromStateDetails } from '../../connection/connection_params.js';
import { sleep } from '../../utils/sleep.js';
import { useConnectionState } from '../../connection/connection_registry.js';
import { useRouteContext } from '../../router.js';
import { useNotebookState } from '../../notebook/notebook_state_registry.js';

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

    const [notebook, _modifyNotebook] = useNotebookState(route.notebookId ?? null);
    const [connection, _modifyConnection] = useConnectionState(notebook?.connectionId ?? null);
    const [state, setState] = React.useState<State>(() => ({
        publicURLText: null,
        copyStartedAt: null,
        copyFinishedAt: null,
        copyError: null,
        uiResetAt: null,
    }));
    const [settings, setSettings] = React.useState<NotebookExportSettings>({
        withCatalog: false,
    });

    React.useEffect(() => {
        if (!props.isOpen) {
            return;
        }
        let setupUrl: URL | null = null;
        if (notebook != null && connection != null) {
            const conn = getConnectionParamsFromStateDetails(connection.details);
            const proto = encodeNotebookAsProto(notebook, true, conn);
            setupUrl = encodeNotebookProtoAsUrl(proto, NotebookLinkTarget.WEB);
        }
        setState({
            publicURLText: setupUrl?.toString() ?? null,
            copyStartedAt: null,
            copyFinishedAt: null,
            copyError: null,
            uiResetAt: null,
        });
    }, [settings, notebook, connection, props.isOpen]);

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
            <Box className={classNames(styles.sharing_overlay, props.className)}>
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
                    settings={settings}
                    setSettings={setSettings}
                />
            </Box>
        </AnchoredOverlay>
    );
};

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Form, InputGroup, Button } from 'react-bootstrap';
import LZString from 'lz-string';
import copy from 'copy-to-clipboard';
import * as utils from '../utils';

import icon_clipboard from '../../static/svg/icons/clipboard_text.svg';
import icon_clipboard_ok from '../../static/svg/icons/clipboard_check.svg';
import styles from './share_dialog.module.css';
import { ScriptMetadata, ScriptOriginType } from '../model';
import { useWorkflowSessionState } from '../backend/workflow_session';

interface Props {
    onClose: () => void;
}

interface Links {
    viewerURL: string;
    viewerURLCopied: boolean;
    explorerURL: string;
    explorerURLCopied: boolean;
    inlinedScript: boolean;
}

const buildLinks = (text: string, metadata: ScriptMetadata | null = null, inline: boolean | null = null): Links => {
    const baseURL = process.env.DASHQL_APP_URL;
    const viewerURL = new URL(`${baseURL}/viewer`);
    const explorerURL = new URL(`${baseURL}/explorer`);
    const originType = metadata?.origin.originType ?? ScriptOriginType.LOCAL;

    // Inline script text?
    if (inline || originType == ScriptOriginType.LOCAL) {
        const t = LZString.compressToBase64(text);
        viewerURL.searchParams.set('text', t);
        explorerURL.searchParams.set('text', t);
        if (metadata?.origin.fileName) {
            viewerURL.searchParams.set('name', encodeURIComponent(metadata.origin.fileName));
            explorerURL.searchParams.set('name', encodeURIComponent(metadata.origin.fileName));
        }
        return {
            viewerURL: viewerURL.toString(),
            viewerURLCopied: false,
            explorerURL: explorerURL.toString(),
            explorerURLCopied: false,
            inlinedScript: true,
        };
    }

    switch (originType) {
        case ScriptOriginType.HTTP:
        case ScriptOriginType.HTTPS: {
            const encoded = encodeURIComponent(metadata.origin.httpURL.toString());
            viewerURL.searchParams.set('url', encoded);
            explorerURL.searchParams.set('url', encoded);
            return {
                viewerURL: viewerURL.toString(),
                viewerURLCopied: false,
                explorerURL: explorerURL.toString(),
                explorerURLCopied: false,
                inlinedScript: false,
            };
        }
        case ScriptOriginType.GITHUB_GIST:
            viewerURL.searchParams.set('gist', metadata.origin.githubGistName);
            explorerURL.searchParams.set('gist', metadata.origin.githubGistName);
            return {
                viewerURL: viewerURL.toString(),
                viewerURLCopied: false,
                explorerURL: explorerURL.toString(),
                explorerURLCopied: false,
                inlinedScript: false,
            };
        case ScriptOriginType.EXAMPLES:
            viewerURL.searchParams.set('example', metadata.origin.exampleName);
            explorerURL.searchParams.set('example', metadata.origin.exampleName);
            return {
                viewerURL: viewerURL.toString(),
                viewerURLCopied: false,
                explorerURL: explorerURL.toString(),
                explorerURLCopied: false,
                inlinedScript: false,
            };
    }
};

export const ShareDialog: React.FC<Props> = (_props: Props) => {
    const sessionState = useWorkflowSessionState();
    const [links, setLinks] = React.useState<Links>(() =>
        buildLinks(sessionState.programText, sessionState.scriptMetadata),
    );
    const copyViewerURL = React.useCallback(() => {
        setLinks(s => {
            copy(s.viewerURL);
            return {
                ...s,
                viewerURLCopied: true,
                explorerURLCopied: false,
            };
        });
    }, []);
    const copyExplorerURL = React.useCallback(() => {
        setLinks(s => {
            copy(s.explorerURL);
            return {
                ...s,
                viewerURLCopied: false,
                explorerURLCopied: true,
            };
        });
    }, []);
    React.useEffect((): (() => void) => {
        if (!links.viewerURLCopied && !links.explorerURLCopied) return undefined;
        const timer = setTimeout(() => {
            setLinks(s => ({
                ...s,
                viewerURLCopied: false,
                explorerURLCopied: false,
            }));
        }, 5000);
        return () => {
            clearTimeout(timer);
        };
    }, [links.viewerURLCopied, links.explorerURLCopied]);

    const canToggleInlining =
        (sessionState.scriptMetadata?.origin.originType ?? ScriptOriginType.LOCAL) !== ScriptOriginType.LOCAL;
    const toggleInlining = (_event: React.ChangeEvent) => {
        const newLinks = buildLinks(sessionState.programText, sessionState.scriptMetadata, !links.inlinedScript);
        setLinks(newLinks);
    };

    return (
        <AnimatePresence>
            <motion.div
                className={styles.container}
                initial={{ translateY: 20 }}
                animate={{ translateY: 0 }}
                onClick={e => e.stopPropagation()}
            >
                <div className={styles.header}>Share Dashboard</div>
                <div className={styles.body}>
                    <div className={styles.share_url_table}>
                        <div className={styles.share_url_type}>Viewer</div>
                        <div className={styles.share_url_text}>
                            <InputGroup>
                                <Form.Control size="sm" type="text" placeholder={links.viewerURL} disabled />
                                <Button onClick={copyViewerURL}>
                                    <svg width="16px" height="16px">
                                        <use
                                            xlinkHref={`${
                                                links.viewerURLCopied ? icon_clipboard_ok : icon_clipboard
                                            }#sym`}
                                        />
                                    </svg>
                                </Button>
                            </InputGroup>
                        </div>
                        <div className={styles.share_url_type}>Explorer</div>
                        <div className={styles.share_url_text}>
                            <InputGroup>
                                <Form.Control size="sm" type="text" placeholder={links.explorerURL} disabled />
                                <Button onClick={copyExplorerURL}>
                                    <svg width="16px" height="16px">
                                        <use
                                            xlinkHref={`${
                                                links.explorerURLCopied ? icon_clipboard_ok : icon_clipboard
                                            }#sym`}
                                        />
                                    </svg>
                                </Button>
                            </InputGroup>
                        </div>
                        <div className={styles.share_stats}>
                            ~&nbsp;{utils.formatBytes(utils.estimateUTF16Length(links.explorerURL))}
                        </div>
                        <div className={styles.share_url_immutable}>
                            <Form.Switch
                                label="Encode Script into URL"
                                defaultChecked={links.inlinedScript}
                                disabled={!canToggleInlining}
                                onChange={toggleInlining}
                            />
                        </div>
                    </div>
                </div>
            </motion.div>
        </AnimatePresence>
    );
};

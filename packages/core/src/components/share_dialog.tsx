import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Form, InputGroup, Button } from 'react-bootstrap';
import LZString from 'lz-string';
import copy from 'copy-to-clipboard';

import icon_clipboard from '../../static/svg/icons/clipboard_text.svg';
import icon_clipboard_ok from '../../static/svg/icons/clipboard_check.svg';
import styles from './share_dialog.module.css';
import { Script, ScriptOriginType, useProgramContext } from '../model';
import { utils } from '../';

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

const buildLinks = (script: Script, inline: boolean | null = null): Links => {
    const baseURL = 'https://app.dashql.com';
    const viewerURL = new URL(`${baseURL}/viewer`);
    const explorerURL = new URL(`${baseURL}/explorer`);

    // Inline script text?
    if (inline || script.origin.originType == ScriptOriginType.LOCAL) {
        const text = LZString.compressToBase64(script.text);
        viewerURL.searchParams.set('name', encodeURIComponent(script.origin.fileName));
        viewerURL.searchParams.set('text', text);
        explorerURL.searchParams.set('name', encodeURIComponent(script.origin.fileName));
        explorerURL.searchParams.set('text', text);
        return {
            viewerURL: viewerURL.toString(),
            viewerURLCopied: false,
            explorerURL: explorerURL.toString(),
            explorerURLCopied: false,
            inlinedScript: true,
        };
    }

    switch (script.origin.originType) {
        case ScriptOriginType.HTTP:
        case ScriptOriginType.HTTPS: {
            const encoded = encodeURIComponent(script.origin.httpURL.toString());
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
            viewerURL.searchParams.set('gist', script.origin.githubGistName);
            explorerURL.searchParams.set('gist', script.origin.githubGistName);
            return {
                viewerURL: viewerURL.toString(),
                viewerURLCopied: false,
                explorerURL: explorerURL.toString(),
                explorerURLCopied: false,
                inlinedScript: false,
            };
        case ScriptOriginType.EXAMPLES:
            viewerURL.searchParams.set('example', script.origin.exampleName);
            explorerURL.searchParams.set('example', script.origin.exampleName);
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
    const programCtx = useProgramContext();
    const [links, setLinks] = React.useState<Links>(() => buildLinks(programCtx.script));
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

    const canToggleInlining = programCtx.script.origin.originType != ScriptOriginType.LOCAL;
    const toggleInlining = (_event: React.ChangeEvent) => {
        const newLinks = buildLinks(programCtx.script, !links.inlinedScript);
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

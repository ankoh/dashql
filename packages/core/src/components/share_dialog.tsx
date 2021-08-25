import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Form, InputGroup, Button } from 'react-bootstrap';
import LZString from 'lz-string';

import icon_clipboard from '../../static/svg/icons/clipboard_text.svg';
import styles from './share_dialog.module.css';
import { Script, ScriptOriginType, useProgramContext } from '../model';
import { utils } from '../';

interface Props {
    onClose: () => void;
}

interface Links {
    viewerURL: string;
    explorerURL: string;
    inlinedScript: boolean;
}

const buildLinks = (script: Script, inline: boolean | null = null): Links => {
    const baseURL = 'https://app.dashql.com';
    const viewerURL = new URL(`${baseURL}/viewer`);
    const explorerURL = new URL(`${baseURL}/explorer`);

    // Inline script text?
    if (inline || script.origin.originType == ScriptOriginType.LOCAL) {
        const encoded = LZString.compressToBase64(script.text);
        viewerURL.searchParams.set('text', encoded);
        viewerURL.searchParams.set('name', script.origin.fileName);
        explorerURL.searchParams.set('text', encoded);
        explorerURL.searchParams.set('name', script.origin.fileName);
        return {
            viewerURL: viewerURL.toString(),
            explorerURL: explorerURL.toString(),
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
                explorerURL: explorerURL.toString(),
                inlinedScript: false,
            };
        }
        case ScriptOriginType.GITHUB_GIST:
            viewerURL.searchParams.set('gist', script.origin.githubGistName);
            explorerURL.searchParams.set('gist', script.origin.githubGistName);
            return {
                viewerURL: viewerURL.toString(),
                explorerURL: explorerURL.toString(),
                inlinedScript: false,
            };
        case ScriptOriginType.EXAMPLES:
            viewerURL.searchParams.set('example', script.origin.exampleName);
            explorerURL.searchParams.set('example', script.origin.exampleName);
            return {
                viewerURL: viewerURL.toString(),
                explorerURL: explorerURL.toString(),
                inlinedScript: false,
            };
    }
};

export const ShareDialog: React.FC<Props> = (_props: Props) => {
    const programCtx = useProgramContext();
    const [links, setLinks] = React.useState<Links>(() => buildLinks(programCtx.script));

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
                                <Form.Control size="sm" type="text" placeholder={links.viewerURL} readOnly />
                                <Button>
                                    <svg width="16px" height="16px">
                                        <use xlinkHref={`${icon_clipboard}#sym`} />
                                    </svg>
                                </Button>
                            </InputGroup>
                        </div>
                        <div className={styles.share_url_type}>Explorer</div>
                        <div className={styles.share_url_text}>
                            <InputGroup>
                                <Form.Control size="sm" type="text" placeholder={links.explorerURL} readOnly />
                                <Button>
                                    <svg width="16px" height="16px">
                                        <use xlinkHref={`${icon_clipboard}#sym`} />
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

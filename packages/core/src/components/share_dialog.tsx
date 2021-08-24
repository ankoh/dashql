import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Form, InputGroup, Button } from 'react-bootstrap';

import icon_clipboard from '../../static/svg/icons/clipboard_text.svg';
import styles from './share_dialog.module.css';

interface Props {
    onClose: () => void;
}

export const ShareDialog: React.FC<Props> = (_props: Props) => {
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
                                <Form.Control
                                    size="sm"
                                    type="text"
                                    placeholder="https://app.dashql.com/viewer?foo"
                                    readOnly
                                />
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
                                <Form.Control
                                    size="sm"
                                    type="text"
                                    placeholder="https://app.dashql.com/explorer?foo"
                                    readOnly
                                />
                                <Button>
                                    <svg width="16px" height="16px">
                                        <use xlinkHref={`${icon_clipboard}#sym`} />
                                    </svg>
                                </Button>
                            </InputGroup>
                        </div>
                        <div className={styles.share_url_immutable}>
                            <Form.Switch label="Encode Script into URL" defaultChecked={false} disabled />
                        </div>
                    </div>
                </div>
            </motion.div>
        </AnimatePresence>
    );
};

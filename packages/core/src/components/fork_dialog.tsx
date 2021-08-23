import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

import styles from './fork_dialog.module.css';

import icon_github from '../../static/svg/icons/github.svg';
import icon_copy from '../../static/svg/icons/file_multiple.svg';

interface Props {
    onClose: () => void;
}

export const ForkDialog: React.FC<Props> = (_props: Props) => {
    return (
        <AnimatePresence>
            <motion.div className={styles.container} initial={{ translateY: 20 }} animate={{ translateY: 0 }}>
                <div className={styles.header}>Fork Script</div>
                <div className={styles.body}>
                    <div className={styles.fork_target_list}>
                        <div className={styles.fork_target}>
                            <svg width="28px" height="28px">
                                <use xlinkHref={`${icon_github}#sym`} />
                            </svg>
                        </div>
                        <div className={styles.fork_target}>
                            <svg width="20px" height="20px">
                                <use xlinkHref={`${icon_copy}#sym`} />
                            </svg>
                        </div>
                    </div>
                </div>
            </motion.div>
        </AnimatePresence>
    );
};

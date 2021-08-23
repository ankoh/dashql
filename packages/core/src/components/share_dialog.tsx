import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

import styles from './share_dialog.module.css';

interface Props {
    onClose: () => void;
}

export const ShareDialog: React.FC<Props> = (_props: Props) => {
    return (
        <AnimatePresence>
            <motion.div className={styles.container} initial={{ translateY: 20 }} animate={{ translateY: 0 }}>
                <div className={styles.header}>Fork Script</div>
                <div className={styles.body}>
                    <div className={styles.fork_target_list}>
                        <div className={styles.fork_target}></div>
                        <div className={styles.fork_target}></div>
                    </div>
                </div>
            </motion.div>
        </AnimatePresence>
    );
};

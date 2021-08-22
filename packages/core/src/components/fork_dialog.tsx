import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

import styles from './fork_dialog.module.css';

interface Props {
    onClose: () => void;
}

export const ForkDialog: React.FC<Props> = (props: Props) => {
    return (
        <div className={styles.overlay}>
            <AnimatePresence>
                <motion.div className={styles.dialog} initial={{ translateY: 30 }} animate={{ translateY: 0 }}>
                    FORK
                </motion.div>
            </AnimatePresence>
        </div>
    );
};

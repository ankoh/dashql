import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

import styles from './share_dialog.module.css';

interface Props {
    onClose: () => void;
}

export const ShareDialog: React.FC<Props> = (_props: Props) => {
    return (
        <AnimatePresence>
            <motion.div className={styles.container} initial={{ translateY: 30 }} animate={{ translateY: 0 }}>
                FORK
            </motion.div>
        </AnimatePresence>
    );
};

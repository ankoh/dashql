import * as React from 'react';
import styles from './system_card.module.css';
import classNames from 'classnames';
import { motion, AnimatePresence } from 'framer-motion';

import icon_close from '../../static/svg/icons/close.svg';

interface Props {
    className?: string;
    children?: React.ReactNode;
    title: string;
    onClose?: () => void;
}

export const SystemCard: React.FC<Props> = (props: Props) => (
    <AnimatePresence>
        <motion.div
            className={classNames(styles.panel, props.className)}
            initial={{ translateY: 30 }}
            animate={{ translateY: 0 }}
        >
            <motion.div className={styles.header}>
                <motion.div className={styles.header_title}>{props.title}</motion.div>
                <motion.div className={styles.close} onClick={props.onClose}>
                    <svg width="20px" height="20px">
                        <use xlinkHref={`${icon_close}#sym`} />
                    </svg>
                </motion.div>
            </motion.div>
            <motion.div className={styles.content}>{props.children}</motion.div>
        </motion.div>
    </AnimatePresence>
);

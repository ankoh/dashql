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

export class SystemCard extends React.Component<Props> {
    public render(): React.ReactElement {
        return (
            <AnimatePresence>
                <motion.div
                    className={classNames(styles.panel, this.props.className)}
                    initial={{ translateY: 30 }}
                    animate={{ translateY: 0 }}
                >
                    <motion.div className={styles.header}>
                        <motion.div className={styles.header_title}>{this.props.title}</motion.div>
                        <motion.div className={styles.close} onClick={this.props.onClose}>
                            <svg width="20px" height="20px">
                                <use xlinkHref={`${icon_close}#sym`} />
                            </svg>
                        </motion.div>
                    </motion.div>
                    <motion.div className={styles.content}>{this.props.children}</motion.div>
                </motion.div>
            </AnimatePresence>
        );
    }
}

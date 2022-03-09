import * as React from 'react';
import { SystemCard } from './system_card';

import icon_github from '../../static/svg/icons/github.svg';
import styles from './system_info.module.css';

interface Props {
    className?: string;
    onClose: () => void;
}

export const SystemInfo: React.FC<Props> = (props: Props) => (
    <SystemCard title="System" onClose={props.onClose} className={props.className}>
        <div className={styles.content}>
            <div className={styles.repo}>
                <div className={styles.repo_icon_container}>
                    <svg className={styles.repo_icon} width="32px" height="32px">
                        <use xlinkHref={`${icon_github}#sym`} />
                    </svg>
                </div>
            </div>
        </div>
    </SystemCard>
);

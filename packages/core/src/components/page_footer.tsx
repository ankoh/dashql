import * as React from 'react';

import icon_github from '../../static/svg/icons/github.svg';
import icon_chat from '../../static/svg/icons/chat.svg';

import styles from './page_footer.module.css';

interface Props {
    github?: string;
}

// const DISCORD_INVITE = 'https://google.com';
// const GITHUB_BASE_URL = 'https://github.com/ankoh/dashql/blob/master/';

export const PageFooter: React.FC<Props> = (props: Props) => (
    <div className={styles.container}>
        <div className={styles.content}>
            <svg className={styles.icon}>
                <use xlinkHref={`${icon_github}#sym`} />
            </svg>
            <a className={styles.link} href="https://google.com" target="_blank" rel="noreferrer">
                Code
            </a>
            <svg className={styles.icon}>
                <use xlinkHref={`${icon_chat}#sym`} />
            </svg>
            <a className={styles.link} href="https://google.com" target="_blank" rel="noreferrer">
                Feedback
            </a>
        </div>
    </div>
);

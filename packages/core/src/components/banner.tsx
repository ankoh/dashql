import * as React from 'react';

import styles from './banner.module.css';

type Props = Record<string, string>;

export class Banner extends React.Component<Props> {
    constructor(props: Props) {
        super(props);
    }

    public render(): React.ReactElement {
        return (
            <div className={styles.banner_bar}>
                <span className={styles.banner_text}>
                    <b>CAUTION:</b>&nbsp;Alpha-quality software in the wild! Talk to us
                </span>
                <a
                    className={styles.banner_link}
                    target="_blank"
                    href="https://github.com/dashql/dashql/discussions"
                    rel="noreferrer"
                >
                    here
                </a>
            </div>
        );
    }
}

export function withBanner<P>(Component: React.ComponentType<P>): React.FunctionComponent<P> {
    // eslint-disable-next-line react/display-name
    return (props: P) => {
        return (
            <div className={styles.container}>
                <Banner />
                <div className={styles.page}>
                    <Component {...props} />
                </div>
            </div>
        );
    };
}

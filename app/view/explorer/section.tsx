import * as React from 'react';

import styles from './section.module.scss';

type Props = {
    title: string;
};

class Section extends React.Component<Props> {
    render() {
        return (
            <div className={styles.section}>
                <div className={styles.section_header}>{this.props.title}</div>
                {this.props.children}
            </div>
        );
    }
}

export default Section;

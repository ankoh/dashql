import * as React from 'react';
import classNames from 'classnames';

import styles from './subsection.module.scss';

type Props = {
    children?: React.ReactNodeArray;
    title: string;
    onMouseOver: (event: React.MouseEvent) => void;
    onMouseLeave: (event: React.MouseEvent) => void;
    onAdd: (event: React.MouseEvent) => void;
};

class Subsection extends React.Component<Props> {
    static defaultProps = {
        onMouseOver: () => {},
        onMouseLeave: () => {},
    };

    render() {
        return (
            <div
                className={styles.subsection}
                onMouseOver={this.props.onMouseOver}
                onMouseLeave={this.props.onMouseLeave}
            >
                <div
                    className={classNames(styles.subsection_header, {
                        [styles.with_children]:
                            this.props.children &&
                            this.props.children.length > 0,
                    })}
                />
                <div className={styles.subsection_title}>
                    {this.props.title}
                </div>
                <div
                    className={styles.subsection_badge}
                    onClick={this.props.onAdd}
                >
                    +
                </div>
                <div className={styles.subsection_entries}>
                    {this.props.children}
                </div>
            </div>
        );
    }
}

export default Subsection;

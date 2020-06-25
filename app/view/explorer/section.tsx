import * as React from 'react';
import { connect } from 'react-redux';
import classNames from 'classnames';
import * as proto from '@tigon/proto';
import { Dispatch, setTQLHighlights } from '../../store';

import styles from './section.module.scss';

type Props = {
    dispatch: Dispatch;
} & {
    title: string;
    locations: proto.tql.Location[];
    children?: React.ReactNodeArray;
};

class Section extends React.Component<Props> {
    handleMouseOver = (event: React.MouseEvent) => {
        event.stopPropagation();
        this.props.dispatch(setTQLHighlights(this.props.locations));
    };

    handleMouseLeave = (event: React.MouseEvent) => {
        event.stopPropagation();
        this.props.dispatch(setTQLHighlights([]));
    };

    render() {
        return (
            <div
                className={styles.section}
                onMouseOver={this.handleMouseOver}
                onMouseLeave={this.handleMouseLeave}
            >
                <div
                    className={classNames(styles.section_header, {
                        [styles.with_children]:
                            this.props.children &&
                            this.props.children.length > 0,
                    })}
                />
                <div className={styles.section_title}>{this.props.title}</div>
                <div className={styles.section_badge}>+</div>
                <div className={styles.section_entries}>
                    {this.props.children}
                </div>
            </div>
        );
    }
}

export default connect()(Section);

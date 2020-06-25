import * as React from 'react';
import { connect } from 'react-redux';
import classNames from 'classnames';
import * as proto from '@tigon/proto';
import { Dispatch, setTQLGetHighlights, RootState } from '../../store';

import styles from './section.module.scss';

type Props = {
    dispatch: Dispatch;
} & ReturnType<typeof mapStateToProps> & {
        title: string;
        indices: number[];
        children?: React.ReactNodeArray;
    };

const getStatementLocation = (module: proto.tql.Module, index: number) => {
    const statement = module.getStatementsList()[index];

    switch (statement.getStatementCase()) {
        case proto.tql.Statement.StatementCase.PARAMETER:
            return statement.getParameter()?.getLocation();
        case proto.tql.Statement.StatementCase.LOAD:
            return statement.getLoad()?.getLocation();
        case proto.tql.Statement.StatementCase.EXTRACT:
            return statement.getExtract()?.getLocation();
        case proto.tql.Statement.StatementCase.QUERY:
            return statement.getQuery()?.getLocation();
        case proto.tql.Statement.StatementCase.VIZ:
            return statement.getViz()?.getLocation();
        default:
            break;
    }
};

class Section extends React.Component<Props> {
    handleMouseOver = (event: React.MouseEvent) => {
        event.stopPropagation();
        this.props.dispatch(
            setTQLGetHighlights(
                this.props.indices.map(index => () =>
                    getStatementLocation(this.props.module, index),
                ),
            ),
        );
    };

    handleMouseLeave = (event: React.MouseEvent) => {
        event.stopPropagation();
        this.props.dispatch(setTQLGetHighlights([]));
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

const mapStateToProps = (state: RootState) => ({
    module: state.tqlModule,
});

export default connect(mapStateToProps)(Section);

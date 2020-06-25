import * as React from 'react';
import { connect } from 'react-redux';
import classNames from 'classnames';
import * as proto from '@tigon/proto';
import { Dispatch, setTQLGetHighlights, RootState } from '../../store';
import { withAppContext, IAppContext } from '../../app_context';

import styles from './section.module.scss';

type Props = {
    dispatch: Dispatch;
    appContext: IAppContext;
} & ReturnType<typeof mapStateToProps> & {
        title: string;
        indices: number[];
        previousSectionIndex: number | undefined;
        template: string;
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

    getDefaultLocation = () => {
        const location = new proto.tql.Location();
        const begin = new proto.tql.Position();
        const end = new proto.tql.Position();

        begin.setLine(1);
        begin.setColumn(1);
        end.setLine(1);
        end.setColumn(1);

        location.setBegin(begin);
        location.setEnd(end);

        return location;
    };

    getEndLocation = (location: proto.tql.Location) => {
        const result = new proto.tql.Location();
        const begin = new proto.tql.Position();
        const end = new proto.tql.Position();

        const line = location.getEnd()?.getLine() || 1;
        const column = location.getEnd()?.getColumn() || 1;

        begin.setLine(line);
        begin.setColumn(column);
        end.setLine(line);
        end.setColumn(column);

        result.setBegin(begin);
        result.setEnd(end);

        return result;
    };

    getInsertLocation = () => {
        const index =
            this.props.indices[this.props.indices.length - 1] ??
            this.props.previousSectionIndex;

        if (index === undefined) {
            return this.getDefaultLocation();
        }

        const location = getStatementLocation(this.props.module, index);

        if (!location) {
            return this.getDefaultLocation();
        }

        return this.getEndLocation(location);
    };

    handleAdd = (event: React.MouseEvent) => {
        const location = this.getInsertLocation();

        this.props.appContext.controller.editor.replace(
            location,
            this.props.template,
        );
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
                <div className={styles.section_badge} onClick={this.handleAdd}>
                    +
                </div>
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

export default connect(mapStateToProps)(withAppContext(Section));

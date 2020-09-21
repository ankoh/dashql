import * as React from 'react';
import { connect } from 'react-redux';
import * as proto from '@tigon/proto';
import { Dispatch, setTQLGetHighlights, RootState } from '../../store';
import { withAppContext, IAppContext } from '../../app_context';

import styles from './section_entry.module.scss';

type Props = {
    appContext: IAppContext;
    dispatch: Dispatch;
} & ReturnType<typeof mapStateToProps> & {
        index: number;
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

const getName = (module: proto.tql.Module, index: number) => {
    const statement = module.getStatementsList()[index];

    switch (statement.getStatementCase()) {
        case proto.tql.Statement.StatementCase.PARAMETER:
            return statement.getParameter()?.getLabel();
        case proto.tql.Statement.StatementCase.LOAD:
            return statement.getLoad()?.getName();
        case proto.tql.Statement.StatementCase.EXTRACT:
            return statement.getExtract()?.getName();
        case proto.tql.Statement.StatementCase.QUERY:
            return statement.getQuery()?.getName();
        case proto.tql.Statement.StatementCase.VIZ:
            return statement.getViz()?.getName();
        default:
            break;
    }
};

class SectionEntry extends React.Component<Props> {
    handleMouseOverEntry = (event: React.MouseEvent) => {
        event.stopPropagation();
        this.props.dispatch(
            setTQLGetHighlights([
                () => getStatementLocation(this.props.module, this.props.index),
            ]),
        );
    };

    handleMouseLeaveEntry = (event: React.MouseEvent) => {
        event.stopPropagation();
        this.props.dispatch(setTQLGetHighlights([]));
    };

    handleMouseOverName = (event: React.MouseEvent) => {
        event.stopPropagation();
        this.props.dispatch(
            setTQLGetHighlights([
                () =>
                    getName(this.props.module, this.props.index)?.getLocation(),
            ]),
        );
    };

    handleMouseLeaveName = (event: React.MouseEvent) => {
        event.stopPropagation();
        this.props.dispatch(setTQLGetHighlights([]));
    };

    handleDelete = (event: React.MouseEvent) => {
        const location = getStatementLocation(
            this.props.module,
            this.props.index,
        );

        if (location) {
            this.props.appContext.controller.editor.replace(location, null);
        }
    };

    render() {
        return (
            <div
                className={styles.entry}
                onMouseOver={this.handleMouseOverEntry}
                onMouseLeave={this.handleMouseLeaveEntry}
            >
                <span
                    onMouseOver={this.handleMouseOverName}
                    onMouseLeave={this.handleMouseLeaveName}
                >
                    {getName(
                        this.props.module,
                        this.props.index,
                    )?.getString() ?? '(Unnamed)'}
                </span>
                <span
                    className={styles.entry_delete}
                    onClick={this.handleDelete}
                >
                    ✕
                </span>
            </div>
        );
    }
}

const mapStateToProps = (state: RootState) => ({
    module: state.tqlModule,
});

export default connect(mapStateToProps)(withAppContext(SectionEntry));

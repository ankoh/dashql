import * as React from 'react';
import * as core from '@dashql/core';
import * as model from '../../model';
import { connect } from 'react-redux';
import { IAppContext, withAppContext } from '../../app_context';
import { CardFrame } from './card_frame';

interface Props {
    appContext: IAppContext;
    planState: core.model.PlanState;
    card: core.model.Card;
    editable?: boolean;
}

export class TableRenderer extends React.Component<Props> {
    constructor(props: Props) {
        super(props);
    }

    /// Render the table
    public render(): React.ReactElement {
        const data = this.props.card.dataSource!;
        const table = core.model.resolveTableByName(this.props.planState, data.targetQualified);
        if (!table) {
            return <div />;
        }
        return <CardFrame title={this.props.card.title || 'Some Title'} controls={this.props.editable}></CardFrame>;
    }
}

const mapStateToProps = (state: model.AppState) => ({
    planState: state.core.planState,
});

const mapDispatchToProps = (_dispatch: model.Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(withAppContext(TableRenderer));

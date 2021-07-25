import * as React from 'react';
import * as core from '@dashql/core';
import * as model from '../../model';
import { AutoSizer } from 'react-virtualized';
import { connect } from 'react-redux';
import { IAppContext, withAppContext } from '../../app_context';
import { CardFrame } from './card_frame';
import { HexViewer } from './hex_viewer';

interface Props {
    appContext: IAppContext;
    planState: core.model.PlanState;
    card: core.model.CardSpecification;
    editable?: boolean;
}

export class DumpRenderer extends React.Component<Props> {
    constructor(props: Props) {
        super(props);
    }

    /// Render the table
    public render(): React.ReactElement {
        return (
            <CardFrame title={this.props.card.title || 'Some Title'} controls={this.props.editable}>
                <AutoSizer>
                    {({ width, height }) => (
                        <HexViewer
                            planState={this.props.planState}
                            card={this.props.card}
                            editable={this.props.editable}
                            width={width}
                            height={height}
                        />
                    )}
                </AutoSizer>
            </CardFrame>
        );
    }
}

const mapStateToProps = (state: model.AppState) => ({
    planState: state.core.planState,
});

const mapDispatchToProps = (_dispatch: model.Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(withAppContext(DumpRenderer));

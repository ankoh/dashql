import * as React from 'react';
import * as core from '@dashql/core';
import * as model from '../../model';
import { AutoSizer } from 'react-virtualized';
import { connect } from 'react-redux';
import { IAppContext, withAppContext } from '../../app_context';
import { CardFrame } from './card_frame';
import { HexViewer } from './hex_viewer';
import BlobLoader from '../blob_loader';

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
        const target = this.props.card.dataSource!.targetQualified;
        const obj = core.model.resolveBlobByName(this.props.planState, target)!;
        return (
            <CardFrame title={this.props.card.title || target} controls={this.props.editable}>
                <AutoSizer>
                    {({ width, height }) => (
                        <BlobLoader
                            blob={obj.blob}
                            loadingComponent={() => <div>loading...</div>}
                            errorComponent={e => <div>Error: {e}</div>}
                        >
                            {buffer => <HexViewer buffer={buffer} width={width} height={height} />}
                        </BlobLoader>
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
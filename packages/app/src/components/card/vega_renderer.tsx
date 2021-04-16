import * as Immutable from 'immutable';
import * as React from 'react';
import * as arrow from 'apache-arrow';
import * as core from '@dashql/core';
import * as model from '../../model';
import { connect } from 'react-redux';
import { AutoSizer } from '../../util/autosizer';
import { IAppContext, withAppContext } from '../../app_context';
import { Vega } from 'react-vega';
import { CardFrame } from './card_frame';

interface Props {
    appContext: IAppContext;
    tables: Immutable.Map<string, core.model.Table>;
    card: core.model.Card;
    editable?: boolean;
}

export class VegaRenderer extends React.Component<Props> {
    protected renderContent(table: core.model.Table, width: number, height: number): React.ReactElement {
        const vega = (result: arrow.Table, w: number, h: number) => (
            <Vega
                style={{
                    width: w,
                    height: h,
                }}
                spec={this.props.card.vegaSpec as any}
                data={{ source: result.toArray() }}
                width={w}
                height={h}
                actions={false}
            />
        );
        console.assert(!!this.props.card.dataSource);

        switch (this.props.card.dataSource!.dataResolver) {
            case core.model.CardDataResolver.M5: {
                return (
                    <core.access.M5Provider
                        logger={this.props.appContext.platform!.logger}
                        database={this.props.appContext.platform!.database}
                        table={table}
                        data={this.props.card.dataSource!}
                        width={width}
                    >
                        {result => vega(result, width, height)}
                    </core.access.M5Provider>
                );
            }

            case core.model.CardDataResolver.RESERVOIR_SAMPLE: {
                return (
                    <core.access.SampleProvider
                        logger={this.props.appContext.platform!.logger}
                        database={this.props.appContext.platform!.database}
                        table={table}
                        data={this.props.card.dataSource!}
                    >
                        {result => vega(result, width, height)}
                    </core.access.SampleProvider>
                );
            }

            default:
                return <div />;
        }
    }

    public render(): React.ReactElement {
        const targetQualified = this.props.card.dataSource!.targetQualified;
        const table = this.props.tables.get(targetQualified);
        if (!table) {
            return <div />;
        }
        return (
            <CardFrame title={this.props.card.title || 'Some Title'} controls={this.props.editable}>
                <AutoSizer>{({ width, height }) => this.renderContent(table, width, height)}</AutoSizer>
            </CardFrame>
        );
    }
}

const mapStateToProps = (state: model.AppState) => ({
    tables: state.core.planState.tables,
});

const mapDispatchToProps = (_dispatch: model.Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(withAppContext(VegaRenderer));

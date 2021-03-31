import * as Immutable from 'immutable';
import * as React from 'react';
import * as proto from '@dashql/proto';
import * as core from '@dashql/core';
import * as model from '../../model';
import { connect } from 'react-redux';
import { AutoSizer } from '../../util/autosizer';
import { IAppContext, withAppContext } from '../../app_context';
import { Vega } from 'react-vega';
import { CardFrame } from './card_frame';

interface Props {
    appContext: IAppContext;
    tables: Immutable.Map<string, core.model.DatabaseTable>;
    card: core.model.Card;
    editable?: boolean;
}

export class VegaRenderer extends React.Component<Props> {
    protected renderContent(table: core.model.DatabaseTable, width: number, height: number) {
        const vega = (result: proto.duckdb.QueryResult, width: number, height: number) => (
            <core.access.ProxyProvider result={result}>
                {rows => (
                    <Vega
                        style={{
                            width: width,
                            height: height,
                        }}
                        spec={this.props.card.vegaSpec as any}
                        data={{ source: rows }}
                        width={width}
                        height={height}
                        actions={false}
                    />
                )}
            </core.access.ProxyProvider>
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

    public render() {
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
    tables: state.core.databaseTables,
});

const mapDispatchToProps = (_dispatch: model.Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(withAppContext(VegaRenderer));

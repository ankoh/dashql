import * as core from '@dashql/core';
import * as React from 'react';
import { AppState, Dispatch } from '../model';
import { connect } from 'react-redux';

//import { compile as compileVL } from 'vega-lite/build/src/compile/compile.js';
import { Field } from 'vega-lite/build/src/channeldef.js';
import { LayerSpec } from 'vega-lite/build/src/spec/layer.js';
import { TopLevel } from 'vega-lite/build/src/spec/toplevel.js';

export type VegaLiteTLLayerSpec = TopLevel<LayerSpec<Field>>;
export const DEFAULT_VEGA_LITE_MIXINS: VegaLiteTLLayerSpec = {
    autosize: {
        type: 'fit',
        contains: 'padding',
        resize: true,
    },
    title: undefined,
    background: 'transparent',
    padding: 8,
    width: 'container',
    height: 'container',
    layer: [],
};

interface Props {
    script: core.model.Script;
}

class ProgramStatsTeaser extends React.Component<Props> {
    public render() {
        return <div />;
    }
}

const mapStateToProps = (state: AppState) => ({
    plan: state.core.plan,
    planActions: state.core.planState.actions,
});

const mapDispatchToProps = (_dispatch: Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(ProgramStatsTeaser);

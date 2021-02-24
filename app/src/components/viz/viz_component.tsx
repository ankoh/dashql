import * as React from 'react';
import * as core from '@dashql/core';
import TableChart from  './table_chart';

interface Props {
    spec: core.model.VizInfo;
}

export class VizComponent extends React.Component<Props> {
    public render() {
        const spec = this.props.spec;
        return <TableChart targetQualified="global.foo" />
    }
}

export default VizComponent;

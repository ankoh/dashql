import * as React from 'react';
import * as core from '@dashql/core';
import { AutoSizer } from '../../util/autosizer';
import { VictoryChart, VictoryAxis, VictoryLine, VictoryScatter, VictoryTheme } from 'victory';

interface Props {
    vizInfo: core.model.VizInfo;
}

export class VictoryRenderer extends React.Component<Props> {
    public render() {
        const data = [
            { x: 1, y: 2 },
            { x: 2, y: 3 },
            { x: 3, y: 5 },
            { x: 4, y: 4 },
            { x: 5, y: 7 }
        ];
        return (
            <AutoSizer>
                {({height, width}) => (
                    <VictoryChart
                        style={{
                            parent: {
                                width: width,
                                height: height,
                            }
                        }}
                        width={width}
                        height={height}
                        domain={[0, 10]}
                        padding={50}
                        theme={VictoryTheme.material}
                    >
                        <VictoryAxis />
                        <VictoryAxis dependentAxis />
                        <VictoryLine
                            data={data}
                        />
                    </VictoryChart>
                )}
            </AutoSizer>
        );
    }
}

export default VictoryRenderer;

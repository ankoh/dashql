import { createClassFromSpec } from 'react-vega';

export default createClassFromSpec({
    mode: 'vega',
    spec: {
        width: 400,
        height: 200,
        padding: { left: 40, right: 5, top: 5, bottom: 20 },

        scales: [
            {
                name: 'xscale',
                type: 'band',
                range: 'width',
                domain: { data: 'table', field: 'category' },
            },
            {
                name: 'yscale',
                nice: true,
                range: 'height',
                domain: { data: 'table', field: 'amount' },
            },
        ],

        data: [ {name: 'table'} ],

        axes: [
            { orient: 'bottom', scale: 'xscale' },
            { orient: 'left', scale: 'yscale' }
        ],

        marks: [
            {
                type: 'rect',
                from: { data: 'table' },
                encode: {
                    enter: {
                        x: { scale: 'xscale', field: 'category', offset: 1 },
                        width: { scale: 'xscale', band: 1, offset: -1 },
                        y: { scale: 'yscale', field: 'amount' },
                        y2: { scale: 'yscale', value: 0 },
                    },
                    update: {
                        fill: { value: 'steelblue' },
                    },
                    hover: {
                        fill: { value: 'red' },
                    },
                },
            },
            {
                type: 'text',
                encode: {
                    enter: {
                        align: { value: 'center' },
                        baseline: { value: 'bottom' },
                        fill: { value: '#333' },
                    },
                },
            },
        ],
    }
});


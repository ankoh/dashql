import * as webdb from '@dashql/webdb';
import * as Immutable from 'immutable';
import { beforeAll, beforeEach, describe, test, expect } from '@jest/globals';
import { analyzer } from '../../src/index_node';
import each from 'jest-each';
import { model, proto, viz } from '../../src/index_node';
import * as vl from 'vega-lite';
import * as path from 'path';

interface VizComposerTestExpectation {
    renderer: model.VizRendererType;
    dataSource: model.VizDataSource;
    vegaLite: any;
}

interface VizComposerTest {
    query: string;
    table: Omit<model.DatabaseTableInfo, keyof model.PlanObject>;
    expected: VizComposerTestExpectation;
}

const DOUBLE_TYPE: webdb.SQLType = {
    typeId: proto.webdb.SQLTypeID.DOUBLE,
    width: 0,
    scale: 0,
};

const ROW_COUNT = () => model.buildTableStatisticsKey(model.TableStatisticsType.COUNT_STAR, 0);
const MAX_VALUE = (col: number) => model.buildTableStatisticsKey(model.TableStatisticsType.MAXIMUM_VALUE, col);
const MIN_VALUE = (col: number) => model.buildTableStatisticsKey(model.TableStatisticsType.MINIMUM_VALUE, col);

const tests: [string, VizComposerTest][] = [
    [
        'nocompletion/m4',
        {
            query: `
VIZ foo USING VEGA (
    title = 'Line Chart',
    position = (row = 0, column = 6, width = 6, height = 4),
    mark = 'line',
    encoding = (
        x = (field = 'x', type = 'quantitative'),
        y = (field = 'y', type = 'quantitative')
    )
);`,
            table: {
                tableNameQualified: 'global.foo',
                tableNameShort: 'foo',
                columnNames: ['x', 'y'],
                columnNameMapping: new Map([
                    ['x', 0],
                    ['y', 1],
                ]),
                columnTypes: [DOUBLE_TYPE, DOUBLE_TYPE],
                statistics: Immutable.Map([
                    [MAX_VALUE(0), [webdb.Value.DOUBLE(100.0)]],
                    [MIN_VALUE(0), [webdb.Value.DOUBLE(0.0)]],
                ]),
            },
            expected: {
                renderer: model.VizRendererType.BUILTIN_VEGA,
                dataSource: {
                    queryType: model.VizQueryType.M4,
                    targetQualified: 'global.foo',
                    m4Config: {
                        attributeX: 'x',
                        attributeY: 'y',
                        domainX: [0.0, 100.0],
                    },
                    sampleSize: 10000,
                },
                vegaLite: {
                    ...viz.DEFAULT_VEGA_LITE_MIXINS,
                    layer: [
                        {
                            mark: 'line',
                            encoding: {
                                x: {
                                    field: 'x',
                                    type: 'quantitative',
                                },
                                y: {
                                    field: 'y',
                                    type: 'quantitative',
                                },
                            },
                        },
                    ],
                },
            },
        },
    ],
];

class FakeStatisticsResolver {
    _table: model.DatabaseTableInfo;

    constructor(test: VizComposerTest) {
        const now = new Date();
        this._table = {
            objectId: 0,
            objectType: model.PlanObjectType.DATABASE_TABLE_INFO,
            timeCreated: now,
            timeUpdated: now,
            ...test.table,
        };
    }
    /// Resolve the table info
    public resolveTableInfo(): model.DatabaseTableInfo | null {
        return this._table;
    }
    /// Request table statistics
    public request(type: model.TableStatisticsType, columnId: number): Promise<webdb.Value[]> {
        const key = model.buildTableStatisticsKey(type, columnId);
        const values = this._table.statistics.get(key);
        if (values) {
            return Promise.resolve(values);
        }
        throw new Error(`unexpected statistics request: type=${model.TableStatisticsType[type]} column=${columnId}`);
    }
    /// Evaluate table statistics
    public evaluate(): Promise<Map<model.TableStatisticsKey, webdb.Value[]>> {
        return Promise.resolve(new Map(this._table.statistics.toArray()));
    }
}

var ana: analyzer.AnalyzerBindings;
beforeAll(async () => {
    ana = new analyzer.Analyzer({}, path.resolve(__dirname, '../../src/analyzer/analyzer_wasm_node.wasm'));
    await ana.init();
});
beforeEach(async () => {
    ana.reset();
});

describe('VizComposer', () => {
    each(tests).test('%s', async (testName, test: VizComposerTest) => {
        // Parse the query
        const program = ana.parseProgram(test.query);
        expect(program.buffer.errorsLength()).toBe(0);
        expect(program.buffer.statementsLength()).toBe(1);

        // Instantiate the query for the viz specs
        const instance = ana.instantiateProgram();
        expect(instance).not.toBe(null);
        expect(instance!.vizSpecs.size).toBe(1);
        expect(instance!.vizSpecs.has(0)).toBe(true);

        // Prepare the composer
        const stats = new FakeStatisticsResolver(test);
        const composer = new viz.VizComposer(stats);

        // Read the parsed viz spec and pass all components to the composer
        const spec = instance!.vizSpecs.get(0)!;
        for (let i = 0; i < spec.componentsLength(); ++i) {
            const c = spec.components(i)!;
            const type = c.type()!;
            let mods: Map<proto.syntax.VizComponentTypeModifier, boolean> = new Map();
            for (let i = 0; i < c.typeModifiersLength(); ++i) {
                mods.set(c.typeModifiers(i)!, true);
            }
            const optionsJSON = c.options() || '';
            const options = JSON.parse(optionsJSON);
            composer.addComponent(type, mods, options)!;
        }
        composer.combineComponents();
        const out = await composer.compile()!;
        expect(out.renderer).toBe(test.expected.renderer);
        expect(out.dataSource).toEqual(test.expected.dataSource);
        expect(out.vegaLiteSpec).toEqual(test.expected.vegaLite);
    });
});

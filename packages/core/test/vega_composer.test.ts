import * as Immutable from 'immutable';
import * as arrow from 'apache-arrow';
import { analyzer, model, proto, viz } from '../src';

interface VizComposerTestExpectation {
    cardRenderer: model.CardRendererType;
    dataSource: model.CardDataSource;
    vegaLite: any;
}

interface VizComposerTest {
    name: string;
    query: string;
    table: Omit<model.TableSummary, keyof model.PlanObject> & { nameQualified: string };
    expected: VizComposerTestExpectation;
}

const DOUBLE_TYPE = new arrow.Float64();

//const ROW_COUNT = () => model.buildTableStatisticsKey(model.TableStatisticsType.COUNT_STAR, 0);
const MAX_VALUE = (col: number) => model.buildTableStatisticsKey(model.TableStatisticsType.MAXIMUM_VALUE, col);
const MIN_VALUE = (col: number) => model.buildTableStatisticsKey(model.TableStatisticsType.MINIMUM_VALUE, col);

const tests: VizComposerTest[] = [
    {
        name: 'vega/line/m5',
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
            nameQualified: 'global.foo',
            tableType: model.TableType.TABLE,
            columnNames: ['x', 'y'],
            columnNameMapping: new Map([
                ['x', 0],
                ['y', 1],
            ]),
            columnTypes: [DOUBLE_TYPE, DOUBLE_TYPE],
            statistics: Immutable.Map([
                [MIN_VALUE(0), arrow.Column.new('_', arrow.Float64Vector.from([0.0]))],
                [MAX_VALUE(0), arrow.Column.new('_', arrow.Float64Vector.from([100.0]))],
                [MIN_VALUE(1), arrow.Column.new('_', arrow.Float64Vector.from([42.0]))],
                [MAX_VALUE(1), arrow.Column.new('_', arrow.Float64Vector.from([2222.0]))],
            ]),
        },
        expected: {
            cardRenderer: model.CardRendererType.BUILTIN_VEGA,
            dataSource: {
                dataResolver: model.CardDataResolver.M5,
                targetQualified: 'global.foo',
                m5Config: {
                    attributeX: 'x',
                    attributeY: 'y',
                    domainX: [0.0, 100.0],
                },
                filters: null,
                aggregates: null,
                orderBy: null,
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
                                scale: {
                                    domain: [0.0, 100.0],
                                },
                            },
                            y: {
                                field: 'y',
                                type: 'quantitative',
                                scale: {
                                    domain: [42.0, 2222.0],
                                },
                            },
                        },
                    },
                ],
            },
        },
    },
    {
        name: 'completion/line/m5',
        query: `
VIZ foo USING LINE (
    title = 'Line Chart',
    position = (row = 0, column = 6, width = 6, height = 4)
);`,
        table: {
            nameQualified: 'global.foo',
            tableType: model.TableType.TABLE,
            columnNames: ['x', 'y'],
            columnNameMapping: new Map([
                ['x', 0],
                ['y', 1],
            ]),
            columnTypes: [DOUBLE_TYPE, DOUBLE_TYPE],
            statistics: Immutable.Map([
                [MIN_VALUE(0), arrow.Column.new('_', arrow.Float64Vector.from([0.0]))],
                [MAX_VALUE(0), arrow.Column.new('_', arrow.Float64Vector.from([100.0]))],
                [MIN_VALUE(1), arrow.Column.new('_', arrow.Float64Vector.from([42.0]))],
                [MAX_VALUE(1), arrow.Column.new('_', arrow.Float64Vector.from([2222.0]))],
            ]),
        },
        expected: {
            cardRenderer: model.CardRendererType.BUILTIN_VEGA,
            dataSource: {
                dataResolver: model.CardDataResolver.M5,
                targetQualified: 'global.foo',
                m5Config: {
                    attributeX: 'x',
                    attributeY: 'y',
                    domainX: [0.0, 100.0],
                },
                filters: null,
                aggregates: null,
                orderBy: null,
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
                                scale: {
                                    domain: [0.0, 100.0],
                                },
                            },
                            y: {
                                field: 'y',
                                type: 'quantitative',
                                scale: {
                                    domain: [42.0, 2222.0],
                                },
                            },
                        },
                    },
                ],
            },
        },
    },
];

class FakeStatisticsResolver {
    _table: model.TableSummary;

    constructor(test: VizComposerTest) {
        const now = new Date();
        this._table = {
            objectId: 0,
            objectType: model.PlanObjectType.TABLE_SUMMARY,
            timeCreated: now,
            timeUpdated: now,
            ...test.table,
        };
    }
    /// Resolve the table info
    public resolveTableInfo(): model.TableSummary | null {
        return this._table;
    }
    /// Request table statistics
    public request(type: model.TableStatisticsType, columnId: number): Promise<arrow.Column> {
        const key = model.buildTableStatisticsKey(type, columnId);
        const values = this._table.statistics.get(key);
        if (values) {
            return Promise.resolve(values);
        }
        throw new Error(`unexpected statistics request: type=${model.TableStatisticsType[type]} column=${columnId}`);
    }
    /// Evaluate table statistics
    public evaluate(): Promise<Map<model.TableStatisticsKey, arrow.Column>> {
        return Promise.resolve(new Map(this._table.statistics.toArray()));
    }
}

export function testVegaComposer(az: () => analyzer.AnalyzerBindings): void {
    beforeEach(async () => {
        az().reset();
    });

    describe('VizComposer', () => {
        tests.forEach(test => {
            it(test.name, async () => {
                // Parse the query
                const program = az().parseProgram(test.query);
                expect(program.buffer.errorsLength()).toBe(0);
                expect(program.buffer.statementsLength()).toBe(1);

                // Instantiate the query for the viz specs
                const instance = az().instantiateProgram();
                expect(instance).not.toBe(null);
                expect(instance!.cards.size).toBe(1);
                expect(instance!.cards.has(0)).toBe(true);

                // Prepare the composer
                const stats = new FakeStatisticsResolver(test);
                const composer = new viz.VegaComposer(stats);

                // Read the parsed viz spec and pass all components to the composer
                const spec = instance!.cards.get(0)!;
                for (let i = 0; i < spec.vizComponentsLength(); ++i) {
                    const c = spec.vizComponents(i)!;
                    const type = c.type()!;
                    const mods: Map<proto.syntax.VizComponentTypeModifier, boolean> = new Map();
                    for (let j = 0; j < c.typeModifiersLength(); ++j) {
                        mods.set(c.typeModifiers(j)!, true);
                    }
                    const optionsJSON = c.options() || '';
                    const options = JSON.parse(optionsJSON);
                    composer.addComponent(type, mods, options)!;
                }
                composer.combineComponents();
                const out = await composer.compile()!;
                expect(out.cardRenderer).toBe(test.expected.cardRenderer);
                expect(out.dataSource).toEqual(test.expected.dataSource);
                expect(out.vegaLiteSpec).toEqual(test.expected.vegaLite);
            });
        });
    });
}
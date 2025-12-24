import '@jest/globals';

import * as arrow from 'apache-arrow';
import * as compute from '@ankoh/dashql-compute';
import * as pb from '@ankoh/dashql-protobuf';
import * as buf from "@bufbuild/protobuf";
import * as path from 'path';
import * as fs from 'fs';

import { fileURLToPath } from 'node:url';
import { DataFrameIpcStreamIterable, createDataFrameFromTable, readDataFrame } from './compute_bindings.js';

const distPath = path.resolve(fileURLToPath(new URL('../../../dashql-compute/dist/', import.meta.url)));
const wasmPath = path.resolve(distPath, './dashql_compute_bg.wasm');

beforeAll(async () => {
    expect(async () => await fs.promises.access(wasmPath)).resolves;
    const buf = await fs.promises.readFile(wasmPath);
    await compute.default({
        module_or_path: buf
    });
    const version = compute.getVersion();
    expect(version.text).toMatch(/^[0-9]+.[0-9]+.[0-9]+(\-dev\.[0-9]+)?$/);
});

describe('DashQLCompute Arrow IO', () => {
    const testData = new Int32Array([
        1, 2, 3, 4, 5, 6, 7, 8
    ]);
    const inTable0 = arrow.tableFromArrays({
        test: testData,
    });

    it('Ingest', async () => {
        const dataFrame = createDataFrameFromTable(inTable0);
        dataFrame.free();
    });

    it('IPC stream', async () => {
        const dataFrame = createDataFrameFromTable(inTable0);

        const dataFrameStream = dataFrame.createIpcStream();
        const stream = new DataFrameIpcStreamIterable(dataFrame, dataFrameStream);
        const batchReader = arrow.RecordBatchReader.from<{ 'test': arrow.Int32 }>(stream);
        expect(batchReader.isStream()).toBeTruthy();

        const table = new arrow.Table(batchReader);
        const mapped = table.toArray().map(o => ({ test: o.test }));
        expect(mapped).toEqual([
            { test: 1 },
            { test: 2 },
            { test: 3 },
            { test: 4 },
            { test: 5 },
            { test: 6 },
            { test: 7 },
            { test: 8 },
        ]);

        dataFrameStream.free();
        dataFrame.free();
    })
});

const testOrderByColumn = async (inTable: arrow.Table, columnName: string, asc: boolean, nullsFirst: boolean, mapper: (o: any) => any, expected: any[]) => {
    const dataFrame = createDataFrameFromTable(inTable);
    const dataFrameTransform = buf.create(pb.dashql.compute.DataFrameTransformSchema, {
        orderBy: buf.create(pb.dashql.compute.OrderByTransformSchema, {
            constraints: [{
                fieldName: columnName,
                ascending: asc,
                nullsFirst
            }]
        })
    });
    const orderByConfigBytes = buf.toBinary(pb.dashql.compute.DataFrameTransformSchema, dataFrameTransform);
    const orderedFrame = await dataFrame.transform(orderByConfigBytes);
    dataFrame.free();

    const table = readDataFrame(orderedFrame);
    orderedFrame.free();

    const mapped = table.toArray().map(mapper);
    expect(mapped).toEqual(expected);
};

describe('DashQLCompute OrderBy', () => {
    it('Float64', async () => {
        const t = arrow.tableFromArrays({
            id: new Int32Array([1, 2, 3, 4]),
            score: new Float64Array([42.0, 10.2, 10.1, 30.005])
        });
        testOrderByColumn(t, "score", true, false, o => ({ id: o.id, score: o.score }), [
            { id: 3, score: 10.1 },
            { id: 2, score: 10.2 },
            { id: 4, score: 30.005 },
            { id: 1, score: 42.0 },
        ]);
    });
});

const testBinning = async (inTable: arrow.Table, columnName: string, expectedStats: any[], expectedBins: any[]) => {
    const inFrame = createDataFrameFromTable(inTable);
    const statsTransform = buf.create(pb.dashql.compute.DataFrameTransformSchema, {
        groupBy: buf.create(pb.dashql.compute.GroupByTransformSchema, {
            keys: [],
            aggregates: [
                buf.create(pb.dashql.compute.GroupByAggregateSchema, {
                    fieldName: columnName,
                    outputAlias: "min",
                    aggregationFunction: pb.dashql.compute.AggregationFunction.Min,
                }),
                buf.create(pb.dashql.compute.GroupByAggregateSchema, {
                    fieldName: columnName,
                    outputAlias: "max",
                    aggregationFunction: pb.dashql.compute.AggregationFunction.Max,
                })
            ]
        })
    });
    const statsTransformBuf = buf.toBinary(pb.dashql.compute.DataFrameTransformSchema, statsTransform);
    const statsFrame = await inFrame.transform(statsTransformBuf);

    const binTransform = buf.create(pb.dashql.compute.DataFrameTransformSchema, {
        groupBy: buf.create(pb.dashql.compute.GroupByTransformSchema, {
            keys: [
                buf.create(pb.dashql.compute.GroupByKeySchema, {
                    fieldName: columnName,
                    outputAlias: "bin",
                    binning: buf.create(pb.dashql.compute.GroupByKeyBinningSchema, {
                        statsMinimumFieldName: "min",
                        statsMaximumFieldName: "max",
                        binCount: 8,
                        outputBinWidthAlias: "bin_width",
                        outputBinLbAlias: "bin_lb",
                        outputBinUbAlias: "bin_ub",
                    })
                })
            ],
            aggregates: [
                buf.create(pb.dashql.compute.GroupByAggregateSchema, {
                    fieldName: columnName,
                    outputAlias: "count",
                    aggregationFunction: pb.dashql.compute.AggregationFunction.CountStar,
                })
            ]
        }),
        orderBy: buf.create(pb.dashql.compute.OrderByTransformSchema, {
            constraints: [{
                fieldName: "bin",
                ascending: true,
                nullsFirst: false,
            }]
        })
    });
    const binTransformBuf = buf.toBinary(pb.dashql.compute.DataFrameTransformSchema, binTransform);
    const binnedFrame = await inFrame.transform(binTransformBuf, statsFrame.clone(), undefined);

    const statsTable = readDataFrame(statsFrame);
    const binnedTable = readDataFrame(binnedFrame);
    statsFrame.free();
    binnedFrame.free();
    inFrame.free();

    const stats = statsTable.toArray().map(o => ({ min: o.min, max: o.max }));
    const bins = binnedTable.toArray().map(o => ({
        bin: o.bin,
        binWidth: o.bin_width,
        binLB: o.bin_lb,
        binUB: o.bin_ub,
        count: o.count,
    }));
    expect(stats).toEqual(expectedStats);
    expect(bins).toEqual(expectedBins);
};

describe('DashQLCompute Binning', () => {
    it('Float64', async () => {
        const t = arrow.tableFromArrays({
            id: new Int32Array([
                1, 2, 3, 4,
                5, 6, 7, 8,
                9, 10, 11, 12,
                13, 14, 15, 16,
            ]),
            score: new Float64Array([
                42, 10, 10, 30,
                436, 28054, 7554, 23269, 3972,
                17470, 25733, 5638, 27309, 11486,
                12329, 22070, 9231, 2636, 15536,
            ])
        });
        testBinning(t, "score", [{
            "max": 28054,
            "min": 10,
        }], [
            { bin: 0, binWidth: 3505.5, binLB: 10, binUB: 3515.5, count: 5n },
            {
                bin: 1,
                binWidth: 3505.5,
                binLB: 3515.5,
                binUB: 7021,
                count: 2n
            },
            {
                bin: 2,
                binWidth: 3505.5,
                binLB: 7021,
                binUB: 10526.5,
                count: 1n
            },
            {
                bin: 3,
                binWidth: 3505.5,
                binLB: 10526.5,
                binUB: 14032,
                count: 2n
            },
            {
                bin: 4,
                binWidth: 3505.5,
                binLB: 14032,
                binUB: 17537.5,
                count: 1n
            },
            {
                bin: 5,
                binLB: 17537.5,
                binUB: 21043,
                binWidth: 3505.5,
                count: null,
            },
            {
                bin: 6,
                binWidth: 3505.5,
                binLB: 21043,
                binUB: 24548.5,
                count: 2n
            },
            {
                bin: 7,
                binWidth: 3505.5,
                binLB: 24548.5,
                binUB: 28054,
                count: 3n
            },
        ]);
    });
});

describe('DashQLCompute OrderBy', () => {
    it('Float64', async () => {
        const t = arrow.tableFromArrays({
            id: new Int32Array([1, 2, 3, 4]),
            score: new Float64Array([42.0, 10.2, 10.1, 30.005])
        });
        testOrderByColumn(t, "score", true, false, o => ({ id: o.id, score: o.score }), [
            { id: 3, score: 10.1 },
            { id: 2, score: 10.2 },
            { id: 4, score: 30.005 },
            { id: 1, score: 42.0 },
        ]);
    });
});

const testProjectedFilter = async (inTable: arrow.Table, filters: pb.dashql.compute.FilterTransform[], mapper: (o: any) => any, expected: any[]) => {
    const dataFrame = createDataFrameFromTable(inTable);
    const dataFrameTransform = buf.create(pb.dashql.compute.DataFrameTransformSchema, {
        rowNumber: buf.create(pb.dashql.compute.RowNumberTransformSchema, {
            outputAlias: "rownum",
        }),
        filters: filters,
        projection: buf.create(pb.dashql.compute.ProjectionTransformSchema, {
            fields: ["rownum"],
        })
    });
    const filterBytes = buf.toBinary(pb.dashql.compute.DataFrameTransformSchema, dataFrameTransform);
    const filterFrame = await dataFrame.transform(filterBytes);
    dataFrame.free();

    const filterTable = readDataFrame(filterFrame);
    filterFrame.free();

    const mapped = filterTable.toArray().map(mapper);
    expect(mapped).toEqual(expected);
};

describe('DashQLCompute Projected Filter', () => {
    it('Float64 Range', async () => {
        const t = arrow.tableFromArrays({
            score: new Float64Array([42.0, 10.2, 10.1, 30.005])
        });
        testProjectedFilter(t, [
            buf.create(pb.dashql.compute.FilterTransformSchema, {
                fieldName: "score",
                operator: pb.dashql.compute.FilterOperator.GreaterEqual,
                valueDouble: 10.1,
            }),
            buf.create(pb.dashql.compute.FilterTransformSchema, {
                fieldName: "score",
                operator: pb.dashql.compute.FilterOperator.LessEqual,
                valueDouble: 10.2,
            })
        ], o => ({ rownum: o.rownum }), [
            { rownum: 2n },
            { rownum: 3n },
        ]);
    });
});

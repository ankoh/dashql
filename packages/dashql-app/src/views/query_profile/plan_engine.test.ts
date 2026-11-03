import { tableFromArrays } from '../../tests/arrow_fixtures.js';
import * as dashql from '@ankoh/dashql-core';
import { detectPlanEngine } from './plan_engine.js';
import { peekFormat } from '../query_result/format_peek.js';
import { getPlanResultText } from '../../shell/shell_result.js';

const Engine = dashql.buffers.profile.ProfileEngine;

/// The output of a Trino `EXPLAIN (TYPE DISTRIBUTED, FORMAT JSON)`
const TRINO_PLAN = `{
  "0" : {
    "id" : "6",
    "name" : "Output",
    "children" : [ ]
  }
}`;
const HYPER_PLAN = '{"operator":"executiontarget","operatorId":1}';

describe('detectPlanEngine', () => {
    it('recognizes the plans of Hyper and Trino', () => {
        expect(detectPlanEngine(HYPER_PLAN)).toEqual(Engine.HYPER);
        expect(detectPlanEngine(TRINO_PLAN)).toEqual(Engine.TRINO);
    });

    it('rejects other JSON and text', () => {
        expect(detectPlanEngine('{"a": 1}')).toBeNull();
        expect(detectPlanEngine('[{"operator":"scan"}]')).toBeNull();
        expect(detectPlanEngine('select 1')).toBeNull();
        expect(detectPlanEngine(null)).toBeNull();
    });

    it('marks both plans as plan format and as plan results of the shell', () => {
        expect(peekFormat(HYPER_PLAN)).toEqual('plan');
        expect(peekFormat(TRINO_PLAN)).toEqual('plan');
        expect(peekFormat('{"a": 1}')).toEqual('json');
        for (const plan of [HYPER_PLAN, TRINO_PLAN]) {
            expect(getPlanResultText(tableFromArrays({ value: [plan] }))).toEqual(plan);
        }
        expect(getPlanResultText(tableFromArrays({ value: ['{"0": {"id": "1"}}'] }))).toBeNull();
    });
});

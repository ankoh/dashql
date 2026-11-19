import { describe, expect, it } from 'vitest';
import * as dashql from '@akohn/dashql';
import { detectPlanEngine } from './plan_engine.js';
import { peekFormat } from '../components/data_table/data_table.js';

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

    it('marks both plans as plan format', () => {
        expect(peekFormat(HYPER_PLAN)).toEqual('plan');
        expect(peekFormat(TRINO_PLAN)).toEqual('plan');
        expect(peekFormat('{"a": 1}')).toEqual('json');
    });
});

import { beforeAll, beforeEach, afterEach, describe, test, expect } from '@jest/globals';
import * as dataframe from '../src/index_node';
import * as path from 'path';

var df: dataframe.Dataframe;
const logger = new dataframe.ConsoleLogger();

beforeAll(async () => {
    df = new dataframe.Dataframe(logger, path.resolve(__dirname, '../src/dataframe_wasm.wasm'));
    await df.open();
});

describe('DataframeBindings', () => {
    describe('hello world', () => {
        test('hello world', async () => {
            df.helloWorld();
        });
    });
});

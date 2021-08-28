//import { jest } from '@jest/globals';
import React from 'react';
import renderer from 'react-test-renderer';
import { PlanContextProvider, ProgramContextProvider } from '../model/';
import { AnalyzerProvider } from '../analyzer/';
import * as analyzer from '../analyzer/analyzer_node';
import * as test_env from '../test';
import Editor from './editor';

describe('Editor', () => {
    let az: analyzer.Analyzer | null = null;

    beforeAll(async () => {
        az = await test_env.initAnalyzer();
    });
    afterEach(async () => {
        await az.reset();
    });

    it('renders with empty state', () => {
        let root: renderer.ReactTestRenderer;
        renderer.act(() => {
            root = renderer.create(
                <ProgramContextProvider>
                    <PlanContextProvider>
                        <AnalyzerProvider analyzer={az!}>
                            <Editor readOnly={false} />
                        </AnalyzerProvider>
                    </PlanContextProvider>
                </ProgramContextProvider>,
            );
        });

        expect(root.toJSON()).toMatchSnapshot();
    });
});

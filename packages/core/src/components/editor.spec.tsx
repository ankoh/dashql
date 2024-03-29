import { jest } from '@jest/globals';
import * as Immutable from 'immutable';
import * as analyzer from '../analyzer/analyzer_node';
import * as test_env from '../test';
import React from 'react';
import renderer from 'react-test-renderer';
import { InputValue, PlanContextProvider, ProgramContext, ProgramContextProvider, ScriptOriginType } from '../model/';
import { AnalyzerProvider } from '../analyzer/';
import { Editor } from './editor';
import { OBSERVED_SIZE } from '../utils/size_observer';

describe('Editor', () => {
    let az: analyzer.Analyzer | null = null;
    let windowMock: any;

    beforeAll(async () => {
        az = test_env.ANALYZER;
        windowMock = jest.spyOn(window, 'window', 'get');
        windowMock.mockImplementation(() => ({
            matchMedia: jest.fn().mockImplementation(query => ({
                matches: false,
                media: query,
                onchange: null,
                addEventListener: jest.fn(),
                removeEventListener: jest.fn(),
                dispatchEvent: jest.fn(),
            })),
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            dispatchEvent: jest.fn(),
            setTimeout: setTimeout,
        }));
    });
    afterEach(async () => {
        await az.reset();
        windowMock.mockRestore();
    });

    it('renders with script', () => {
        const programText = `
FETCH vacc_csv FROM 'https://impfdashboard.de/static/data/germany_vaccinations_timeseries_v2.tsv';
LOAD vacc FROM vacc_csv USING CSV;
VIZ vacc USING TABLE;
        `;
        const program = az.parseProgram(programText);
        const script = {
            origin: {
                originType: ScriptOriginType.LOCAL,
                fileName: 'local',
            },
            description: '',
            text: programText,
            modified: false,
        };
        const programInstance = az.instantiateProgram();
        const programCtx: ProgramContext = {
            script,
            program,
            programInstance,
            programInputValues: Immutable.List<InputValue>(),
        };

        const pseudo = document.createElement('div');
        let root: renderer.ReactTestRenderer;
        renderer.act(() => {
            root = renderer.create(
                <ProgramContextProvider initialState={programCtx}>
                    <PlanContextProvider>
                        <AnalyzerProvider value={az!}>
                            <OBSERVED_SIZE.Provider value={{ width: 1000, height: 1000 }}>
                                <Editor readOnly={false} target={pseudo} />
                            </OBSERVED_SIZE.Provider>
                        </AnalyzerProvider>
                    </PlanContextProvider>
                </ProgramContextProvider>,
            );
        });

        expect(root.toJSON()).toMatchSnapshot();
    });
});

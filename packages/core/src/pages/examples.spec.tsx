import { jest } from '@jest/globals';
import * as analyzer from '../analyzer/analyzer_node';
import * as test_env from '../test';
import React from 'react';
import renderer from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { ProgramContextProvider } from '../model/';
import { AnalyzerProvider } from '../analyzer/';
import { Examples } from './examples';

describe('Examples', () => {
    let az: analyzer.Analyzer | null = null;
    let windowMock: any;

    beforeAll(async () => {
        az = await test_env.initAnalyzer();
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

    it('renders correctly with an empty state', () => {
        const tree = renderer
            .create(
                <MemoryRouter>
                    <ProgramContextProvider>
                        <AnalyzerProvider value={az!}>
                            <Examples />
                        </AnalyzerProvider>
                    </ProgramContextProvider>
                </MemoryRouter>,
            )
            .toJSON();
        expect(tree).toMatchSnapshot();
    });
});

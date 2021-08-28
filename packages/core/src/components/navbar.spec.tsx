//import { jest } from '@jest/globals';
import React from 'react';
import renderer from 'react-test-renderer';
import { GitHubProfileProvider, GitHubAuthProvider } from '../github';
import { NavBar } from './navbar';
import { MemoryRouter } from 'react-router-dom/index';

describe('NavBar', () => {
    //let windowSpy: any;
    //beforeEach(() => {
    //    windowSpy = jest.spyOn(window, 'window', 'get');
    //});
    //afterEach(() => {
    //    windowSpy.mockRestore();
    //});

    it('renders correctly', () => {
        //const map = {};
        //const windowAddEventListener = jest.fn();
        //const windowRemoveEventListener = jest.fn();
        //windowAddEventListener.mockImplementationOnce((key: any, cb: () => void) => {
        //    map[key] = cb;
        //});
        //windowSpy.mockImplementation(() => ({
        //    addEventListener: windowAddEventListener,
        //    removeEventListener: windowRemoveEventListener,
        //}));
        //expect(windowSpy).toHaveBeenCalled();
        //expect(windowAddEventListener).toHaveBeenCalledTimes(1);
        //expect(windowRemoveEventListener).toHaveBeenCalledTimes(1);
        const tree = renderer
            .create(
                <MemoryRouter>
                    <GitHubAuthProvider>
                        <GitHubProfileProvider>
                            <NavBar />
                        </GitHubProfileProvider>
                    </GitHubAuthProvider>
                </MemoryRouter>,
            )
            .toJSON();
        expect(tree).toMatchSnapshot();
    });
});

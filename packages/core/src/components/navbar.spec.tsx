//import { jest } from '@jest/globals';
import React from 'react';
import renderer from 'react-test-renderer';
import { GitHubProfileProvider, GitHubAuthProvider } from '../github';
import { NavBar } from './navbar';
import { MemoryRouter } from 'react-router-dom/index';

describe('NavBar', () => {
    it('renders correctly', () => {
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

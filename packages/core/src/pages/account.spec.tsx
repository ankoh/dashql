import React from 'react';
import renderer from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { Account } from './account';

describe('Account', () => {
    it('renders correctly', () => {
        const tree = renderer
            .create(
                <MemoryRouter>
                    <Account />
                </MemoryRouter>,
            )
            .toJSON();
        expect(tree).toMatchSnapshot();
    });
});

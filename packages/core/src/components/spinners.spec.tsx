import React from 'react';
import renderer from 'react-test-renderer';
import { RectangleWaveSpinner } from './spinners';

describe('RectangleWaveSpinner', () => {
    it('renders correctly', () => {
        const tree = renderer.create(<RectangleWaveSpinner active={true} />).toJSON();
        expect(tree).toMatchSnapshot();
    });
});

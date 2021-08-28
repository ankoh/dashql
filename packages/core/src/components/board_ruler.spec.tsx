import React from 'react';
import renderer from 'react-test-renderer';
import { Ruler, RulerOrientation } from './board_ruler';

describe('CurrentTime', () => {
    it('renders correctly', () => {
        const tree = renderer
            .create(
                <Ruler
                    orientation={RulerOrientation.Horizontal}
                    width={200}
                    height={48}
                    scaleFactor={1}
                    containerPadding={2}
                    tickMargin={2}
                    stepLength={2}
                    stepCount={40}
                />,
            )
            .toJSON();
        expect(tree).toMatchSnapshot();
    });
});

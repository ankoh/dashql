import React from 'react';
import renderer from 'react-test-renderer';
import { CardFrame } from './card_frame';

describe('CardFrame', () => {
    it('renders correctly', () => {
        const tree = renderer
            .create(
                <CardFrame>
                    <div>Foo</div>
                </CardFrame>,
            )
            .toJSON();
        expect(tree).toMatchSnapshot();
    });
});

import * as model from '../model';
import React from 'react';
import renderer from 'react-test-renderer';
import { InnerLogViewer } from './log_viewer';

describe('LogViewer', () => {
    it('renders correctly', () => {
        const tree = renderer
            .create(
                <model.LogProvider>
                    <InnerLogViewer
                        currentTime={new Date(Date.UTC(2021, 4, 1))}
                        updateCurrentTime={() => {}}
                        onClose={() => {}}
                    />
                </model.LogProvider>,
            )
            .toJSON();
        expect(tree).toMatchSnapshot();
    });
});

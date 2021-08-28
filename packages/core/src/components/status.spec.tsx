import React from 'react';
import renderer from 'react-test-renderer';
import { StatusIndicator } from './status';
import * as model from '../model';

describe('StatusIndicator', () => {
    it('renders correctly', () => {
        let root: renderer.ReactTestRenderer;
        renderer.act(() => {
            root = renderer.create(<StatusIndicator status={model.Status.NONE} />);
        });
        expect(root.toJSON()).toMatchSnapshot();
        renderer.act(() => {
            root.update(<StatusIndicator status={model.Status.RUNNING} />);
        });
        expect(root.toJSON()).toMatchSnapshot();
        renderer.act(() => {
            root.update(<StatusIndicator status={model.Status.BLOCKED} />);
        });
        expect(root.toJSON()).toMatchSnapshot();
        renderer.act(() => {
            root.update(<StatusIndicator status={model.Status.FAILED} />);
        });
        expect(root.toJSON()).toMatchSnapshot();
        renderer.act(() => {
            root.update(<StatusIndicator status={model.Status.COMPLETED} />);
        });
        expect(root.toJSON()).toMatchSnapshot();
    });
});

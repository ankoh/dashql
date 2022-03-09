import React from 'react';
import renderer from 'react-test-renderer';
import { StatusIndicator } from './status';
import * as rd from '@duckdb/react-duckdb';

describe('StatusIndicator', () => {
    it('renders correctly', () => {
        let root: renderer.ReactTestRenderer;
        renderer.act(() => {
            root = renderer.create(<StatusIndicator status={rd.ResolvableStatus.NONE} />);
        });
        expect(root.toJSON()).toMatchSnapshot();
        renderer.act(() => {
            root.update(<StatusIndicator status={rd.ResolvableStatus.RUNNING} />);
        });
        expect(root.toJSON()).toMatchSnapshot();
        renderer.act(() => {
            root.update(<StatusIndicator status={rd.ResolvableStatus.FAILED} />);
        });
        expect(root.toJSON()).toMatchSnapshot();
        renderer.act(() => {
            root.update(<StatusIndicator status={rd.ResolvableStatus.COMPLETED} />);
        });
        expect(root.toJSON()).toMatchSnapshot();
    });
});

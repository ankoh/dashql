import Immutable from 'immutable';
import * as model from '../model';
import React from 'react';
import renderer from 'react-test-renderer';
import { LogViewer } from './log_viewer';

describe('LogViewer', () => {
    it('renders correctly without entries', () => {
        const tree = renderer
            .create(
                <model.LogProvider>
                    <LogViewer
                        currentTime={new Date(Date.UTC(2021, 4, 1))}
                        updateCurrentTime={() => {}}
                        onClose={() => {}}
                    />
                </model.LogProvider>,
            )
            .toJSON();
        expect(tree).toMatchSnapshot();
    });

    it('renders correctly with logs', () => {
        const state: model.LogState = {
            entries: Immutable.List<model.LogEntryVariant>([
                {
                    timestamp: new Date(Date.UTC(2021, 4, 1, 0, 0, 0)),
                    level: model.LogLevel.INFO,
                    origin: model.LogOrigin.SCRIPT_PIPELINE,
                    topic: model.LogTopic.PARSE_PROGRAM,
                    event: model.LogEvent.OK,
                    value: 'foo',
                },
                {
                    timestamp: new Date(Date.UTC(2021, 4, 1, 0, 0, 0)),
                    level: model.LogLevel.INFO,
                    origin: model.LogOrigin.SCRIPT_PIPELINE,
                    topic: model.LogTopic.INSTANTIATE_PROGRAM,
                    event: model.LogEvent.OK,
                    value: undefined,
                },
            ]),
        };
        let root: renderer.ReactTestRenderer;
        renderer.act(() => {
            root = renderer.create(
                <model.LogProvider initialState={state}>
                    <LogViewer
                        currentTime={new Date(Date.UTC(2021, 4, 1))}
                        updateCurrentTime={() => {}}
                        onClose={() => {}}
                    />
                </model.LogProvider>,
            );
        });
        expect(root.toJSON()).toMatchSnapshot();
    });
});

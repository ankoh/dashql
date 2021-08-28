import { jest } from '@jest/globals';
import React from 'react';
import renderer from 'react-test-renderer';
import { CurrentTime } from './current_time';

interface Props {
    time: Date;
    update: () => void;
    trigger: boolean;
}

const Bounce: React.FC<Props> = (props: Props) => {
    React.useEffect(() => {
        if (props.trigger) props.update();
    }, [props.trigger]);
    return <div>{props.time.toUTCString()}</div>;
};

describe('CurrentTime', () => {
    beforeAll(() => {
        jest.useFakeTimers();
    });

    afterAll(() => {
        jest.useRealTimers();
    });

    it('rerenders with refresh-rate', () => {
        jest.setSystemTime(Date.UTC(2020, 3, 1, 0, 0, 0));

        let root: renderer.ReactTestRenderer;
        renderer.act(() => {
            root = renderer.create(
                <CurrentTime refreshRate={1000}>{(time, _update) => <div>{time.toUTCString()}</div>}</CurrentTime>,
            );
        });
        expect(root.toJSON()).toMatchSnapshot();

        renderer.act(() => jest.advanceTimersByTime(500));
        expect(root.toJSON()).toMatchSnapshot();

        renderer.act(() => jest.advanceTimersByTime(500));
        expect(root.toJSON()).toMatchSnapshot();
    });

    it('updates when requested', () => {
        jest.setSystemTime(Date.UTC(2020, 3, 1, 0, 0, 0));

        let root: renderer.ReactTestRenderer;
        renderer.act(() => {
            root = renderer.create(
                <CurrentTime refreshRate={10000}>
                    {(time, update) => <Bounce time={time} update={update} trigger={false} />}
                </CurrentTime>,
            );
        });
        expect(root.toJSON()).toMatchSnapshot();

        renderer.act(() => jest.advanceTimersByTime(1000));
        expect(root.toJSON()).toMatchSnapshot();

        renderer.act(() => {
            root.update(
                <CurrentTime refreshRate={10000}>
                    {(time, update) => <Bounce time={time} update={update} trigger={true} />}
                </CurrentTime>,
            );
        });
        expect(root.toJSON()).toMatchSnapshot();
    });
});

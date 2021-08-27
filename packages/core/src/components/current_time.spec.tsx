import { jest } from '@jest/globals';
import React from 'react';
import renderer from 'react-test-renderer';
import { CurrentTime } from './current_time';

interface Props {
    time: Date;
    update: () => void;
}

const Bounce: React.FC<Props> = (props: Props) => {
    React.useEffect(() => {
        props.update();
    });
    return <div>{props.time.toString()}</div>;
};

describe('CurrentTime', () => {
    beforeAll(() => {
        jest.useFakeTimers('modern');
        jest.setSystemTime(new Date(2020, 3, 1));
    });

    afterAll(() => {
        jest.useRealTimers();
    });

    it('renders correctly', () => {
        const tree = renderer
            .create(
                <CurrentTime refreshRate={1000}>
                    {(time, update) => <Bounce time={time} update={update} />}
                </CurrentTime>,
            )
            .toJSON();
        expect(tree).toMatchSnapshot();
    });
});

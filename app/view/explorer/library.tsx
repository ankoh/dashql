import * as React from 'react';
import Section from './section';
import Subsection from './subsection';

type Props = {};

type State = {};

class Library extends React.Component<Props, State> {
    render() {
        return (
            <Section title="Library">
                <Subsection title="Files" onAdd={() => {}} />
                <Subsection title="Extract Programs" onAdd={() => {}} />
            </Section>
        );
    }
}

export default Library;

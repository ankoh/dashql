import * as React from 'react';

import { AgentFace, AgentFaceMorphEvent } from './agent_face.js';
import * as styles from './agent_greeting.module.css';

/// The questions the agent face asks on an empty session, in the order they rotate.
/// They speak of the user and the agent together, the analysis is not handed off to the agent.
export const AGENT_GREETINGS: readonly string[] = [
    'What are we exploring today?',
    'What should we look into?',
    'What shall we find out?',
    'What should we analyze together?',
    'Where do we start?'
];

interface AgentGreetingProps {
    /// The props of the face
    face?: React.ComponentProps<typeof AgentFace> & { 'data-testid'?: string };
    /// The class of the question
    questionClassName?: string;
    /// The test id of the question
    questionTestId?: string;
    /// The element of the question
    questionElement?: 'h1' | 'p';
    /// The questions, the greetings of the agent by default
    greetings?: readonly string[];
}

/// The agent face with its question right of it, the face and the question are siblings for the layout of the parent.
/// The question cross-fades to the next one when the face starts to melt into the brand mark.
export function AgentGreeting(props: AgentGreetingProps): React.ReactElement {
    const greetings = props.greetings ?? AGENT_GREETINGS;
    const [index, setIndex] = React.useState(0);
    const onMorph = React.useCallback((event: AgentFaceMorphEvent) => {
        if (event === AgentFaceMorphEvent.Leaving) setIndex(i => (i + 1) % greetings.length);
    }, [greetings.length]);

    const Question = props.questionElement ?? 'h1';
    const questionClassName = props.questionClassName == null ? styles.question : `${styles.question} ${props.questionClassName}`;
    return (
        <>
            <AgentFace {...props.face} onMorph={onMorph} />
            <Question className={questionClassName} data-testid={props.questionTestId}>
                {greetings.map((text, i) => (
                    <span key={text} className={styles.greeting} data-active={i === index ? '' : undefined} aria-hidden={i !== index}>
                        {text}
                    </span>
                ))}
            </Question>
        </>
    );
}

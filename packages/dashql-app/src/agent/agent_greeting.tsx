import * as React from 'react';

import { AgentFace, AgentFaceMorphEvent } from './agent_face.js';
import * as styles from './agent_greeting.module.css';

/// The questions the agent face asks on an empty session, in the order they rotate.
/// They speak of the user and the agent together, the analysis is not handed off to the agent.
export const AGENT_GREETINGS: readonly string[] = [
    'What are we exploring?',
    'What should we look into?',
    'What shall we find out?',
    'What should we analyze?',
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
    /// Show the face, without it only the question is shown and rotates on its own
    showFace?: boolean;
}

/// The time to type a character, jittered so the typing feels like a hand
const TYPE_MS = 14;
const TYPE_JITTER_MS = 10;
/// How often the question rotates without a face, about a cycle of the face
const ROTATE_WITHOUT_FACE_MS = 10000;
/// The time to delete a character
const DELETE_MS = 8;

/// What the question is doing
enum Typing {
    /// The characters appear one by one
    Typing,
    /// The question is complete
    Done,
    /// The characters disappear one by one before the next question
    Deleting,
}

/// The agent face with its question right of it, the face and the question are siblings for the layout of the parent.
/// The question is typed character by character. When the face starts to melt into the brand mark, it is deleted
/// and the next question is typed.
export function AgentGreeting(props: AgentGreetingProps): React.ReactElement {
    const greetings = props.greetings ?? AGENT_GREETINGS;
    const reducedMotion = React.useMemo(() => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, []);
    const [index, setIndex] = React.useState(0);
    const [typing, setTyping] = React.useState(reducedMotion ? Typing.Done : Typing.Typing);
    const chars = React.useMemo(() => Array.from(greetings[index % greetings.length]), [greetings, index]);
    const [count, setCount] = React.useState(reducedMotion ? chars.length : 0);

    const onMorph = React.useCallback((event: AgentFaceMorphEvent) => {
        if (event !== AgentFaceMorphEvent.Leaving) return;
        if (reducedMotion) {
            setIndex(i => (i + 1) % greetings.length);
        } else {
            setTyping(Typing.Deleting);
        }
    }, [greetings.length, reducedMotion]);

    // Without a face, the question rotates on its own
    const showFace = props.showFace ?? true;
    React.useEffect(() => {
        if (showFace) return;
        const timer = setInterval(() => onMorph(AgentFaceMorphEvent.Leaving), ROTATE_WITHOUT_FACE_MS);
        return () => clearInterval(timer);
    }, [showFace, onMorph]);

    // Type or delete the next character
    React.useEffect(() => {
        if (reducedMotion) {
            setCount(chars.length);
            return;
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        if (typing === Typing.Typing) {
            if (count < chars.length) {
                timer = setTimeout(() => setCount(c => c + 1), TYPE_MS + Math.random() * TYPE_JITTER_MS);
            } else {
                setTyping(Typing.Done);
            }
        } else if (typing === Typing.Deleting) {
            if (count > 0) {
                timer = setTimeout(() => setCount(c => Math.max(0, c - 1)), DELETE_MS);
            } else {
                setIndex(i => (i + 1) % greetings.length);
                setTyping(Typing.Typing);
            }
        }
        return () => clearTimeout(timer);
    }, [typing, count, chars, greetings.length, reducedMotion]);

    const Question = props.questionElement ?? 'h1';
    const questionClassName = props.questionClassName == null ? styles.question : `${styles.question} ${props.questionClassName}`;
    return (
        <>
            {showFace && <AgentFace {...props.face} onMorph={onMorph} />}
            <Question className={questionClassName} data-testid={props.questionTestId} aria-label={chars.join('')}>
                {/* Every question takes the cell invisibly, the widest one sizes it so the face does not move */}
                {greetings.map(text => (
                    <span key={text} className={styles.sizer} aria-hidden>{text}</span>
                ))}
                <span className={styles.typed} aria-hidden>
                    {chars.slice(0, count).join('')}
                    <span className={styles.caret} data-active={typing !== Typing.Done ? '' : undefined} />
                </span>
            </Question>
        </>
    );
}

import * as React from 'react';

import { Wobble, WobbleMorphEvent } from './wobble.js';
import * as styles from './agent_greeting.module.css';

/// The questions Wobble asks on an empty workbook, in the order they rotate.
/// They speak of the user and the agent together, the analysis is not handed off to the agent.
export const AGENT_GREETINGS: readonly string[] = [
    'What are we exploring?',
    'What should we look into?',
    'What shall we find out?',
    'What should we analyze?',
    'Where do we start?'
];

interface AgentGreetingProps {
    /// The props of Wobble
    wobble?: React.ComponentProps<typeof Wobble> & { 'data-testid'?: string };
    /// The class of the question
    questionClassName?: string;
    /// The test id of the question
    questionTestId?: string;
    /// The element of the question
    questionElement?: 'h1' | 'p';
    /// The questions, the greetings of the agent by default
    greetings?: readonly string[];
}

/// The time to type a character, jittered so the typing feels like a hand
const TYPE_MS = 14;
const TYPE_JITTER_MS = 10;
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

/// Wobble with its question right of it, Wobble and the question are siblings for the layout of the parent.
/// The question is typed character by character. When Wobble starts to melt into the brand mark, it is deleted
/// and the next question is typed. The question types on its own, the greeting and Wobble render once per question.
export function AgentGreeting(props: AgentGreetingProps): React.ReactElement {
    const greetings = props.greetings ?? AGENT_GREETINGS;
    // The questions Wobble left, the question changes with every one
    const [turn, setTurn] = React.useState(0);
    const onMorph = React.useCallback((event: WobbleMorphEvent) => {
        if (event === WobbleMorphEvent.Leaving) setTurn(t => t + 1);
    }, []);
    const Question = props.questionElement ?? 'h1';
    const questionClassName = props.questionClassName == null ? styles.question : `${styles.question} ${props.questionClassName}`;
    return (
        <>
            <Wobble {...props.wobble} onMorph={onMorph} />
            <TypedQuestion element={Question} className={questionClassName} testId={props.questionTestId}
                greetings={greetings} turn={turn} />
        </>
    );
}

interface TypedQuestionProps {
    element: 'h1' | 'p';
    className: string;
    testId?: string;
    greetings: readonly string[];
    /// The questions Wobble left, the question is deleted and the next one typed when it grows
    turn: number;
}

/// The question, typed character by character, it holds the typing so that a character renders only the question
function TypedQuestion(props: TypedQuestionProps): React.ReactElement {
    const { greetings, turn } = props;
    const reducedMotion = React.useMemo(() => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, []);
    const [index, setIndex] = React.useState(0);
    const [typing, setTyping] = React.useState(reducedMotion ? Typing.Done : Typing.Typing);
    const chars = React.useMemo(() => Array.from(greetings[index % greetings.length]), [greetings, index]);
    const [count, setCount] = React.useState(reducedMotion ? chars.length : 0);

    // Wobble left: delete the question, the next one follows
    const [seenTurn, setSeenTurn] = React.useState(turn);
    if (seenTurn !== turn) {
        setSeenTurn(turn);
        if (reducedMotion) {
            setIndex(i => (i + 1) % greetings.length);
        } else {
            setTyping(Typing.Deleting);
        }
    }

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

    const Question = props.element;
    return (
        <Question className={props.className} data-testid={props.testId} aria-label={chars.join('')}>
            {/* Every question takes the cell invisibly, the widest one sizes it so Wobble does not move */}
            {greetings.map(text => (
                <span key={text} className={styles.sizer} aria-hidden>{text}</span>
            ))}
            <span className={styles.typed} aria-hidden>
                {chars.slice(0, count).join('')}
                <span className={styles.caret} data-active={typing !== Typing.Done ? '' : undefined} />
            </span>
        </Question>
    );
}

import * as React from 'react';
import { createPortal } from 'react-dom';

import { useLogger } from '../platform/logger_provider.js';
import { LogBuffer, LogLevel, LogRecord } from '../platform/log_buffer.js';
import { classNames } from '../utils/classnames.js';

import * as styles from './logger_toast.module.css';

const TOAST_DURATION_MS = 6000;
const TOAST_EXIT_DURATION_MS = 200;
const MAX_VISIBLE_TOASTS = 5;

interface ToastItem {
    id: number;
    record: LogRecord;
    exiting: boolean;
}

interface ToastProps {
    item: ToastItem;
    onDismiss: (id: number) => void;
}

function WarningIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
                d="M10 6V10.5M10 13.5V14M3.5 16.5H16.5C17.3284 16.5 17.9 15.7 17.5 15L10.8 3.5C10.4 2.83333 9.6 2.83333 9.2 3.5L2.5 15C2.1 15.7 2.67157 16.5 3.5 16.5Z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function ErrorIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10 6V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="10" cy="14" r="1" fill="currentColor" />
        </svg>
    );
}

function CloseIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
    );
}

function Toast({ item, onDismiss }: ToastProps) {
    const isWarning = item.record.level === LogLevel.Warn;
    const isError = item.record.level === LogLevel.Error;

    return (
        <div
            className={classNames(
                styles.toast,
                isWarning && styles.toast_warning,
                isError && styles.toast_error,
                item.exiting && styles.toast_exiting
            )}
            role="alert"
            aria-live="assertive"
        >
            <div className={styles.toast_icon}>
                {isError ? <ErrorIcon /> : <WarningIcon />}
            </div>
            <div className={styles.toast_content}>
                <div className={styles.toast_target}>{item.record.target}</div>
                <div className={styles.toast_message}>{item.record.message}</div>
            </div>
            <button
                className={styles.toast_close}
                onClick={() => onDismiss(item.id)}
                aria-label="Dismiss notification"
            >
                <CloseIcon />
            </button>
        </div>
    );
}

export function LoggerToast() {
    const logger = useLogger();
    const [toasts, setToasts] = React.useState<ToastItem[]>([]);
    const nextIdRef = React.useRef(0);

    const dismissToast = React.useCallback((id: number) => {
        // Start exit animation
        setToasts(prev => prev.map(t => (t.id === id ? { ...t, exiting: true } : t)));

        // Remove after animation completes
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, TOAST_EXIT_DURATION_MS);
    }, []);

    React.useEffect(() => {
        const buffer = logger.buffer;
        // Track how many entries we've already seen
        let lastSeenLength = buffer.length;

        const observer = (buf: LogBuffer) => {
            const currentLength = buf.length;

            // Process all new entries since last observation
            for (let i = lastSeenLength; i < currentLength; i++) {
                const record = buf.at(i);
                if (!record) continue;

                // Only show warnings and errors
                if (record.level !== LogLevel.Warn && record.level !== LogLevel.Error) {
                    continue;
                }

                const id = nextIdRef.current++;
                setToasts(prev => {
                    const newToasts = [...prev, { id, record, exiting: false }];
                    // Limit visible toasts
                    if (newToasts.length > MAX_VISIBLE_TOASTS) {
                        return newToasts.slice(-MAX_VISIBLE_TOASTS);
                    }
                    return newToasts;
                });

                // Auto-dismiss after duration
                setTimeout(() => {
                    dismissToast(id);
                }, TOAST_DURATION_MS);
            }

            lastSeenLength = currentLength;
        };

        buffer.observe(observer);

        return () => {
            buffer.observers.delete(observer);
        };
    }, [logger, dismissToast]);

    if (toasts.length === 0) {
        return null;
    }

    return createPortal(
        <div className={styles.toast_container}>
            {toasts.map(item => (
                <Toast key={item.id} item={item} onDismiss={dismissToast} />
            ))}
        </div>,
        document.body
    );
}


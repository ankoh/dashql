import * as React from 'react';
import { createPortal } from 'react-dom';

import { useLogger } from '../platform/logger_provider.js';
import { LogBuffer, LogLevel, LogRecord } from '../platform/log_buffer.js';
import { classNames } from '../utils/classnames.js';

import * as styles from './logger_toast.module.css';
import { SymbolIcon } from './foundations/symbol_icon.js';
import { IconButton } from './foundations/button.js';

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

function Toast({ item, onDismiss }: ToastProps) {
    const isWarning = item.record.level === LogLevel.Warn;
    const isError = item.record.level === LogLevel.Error;
    const CloseIcon = SymbolIcon("x_16");
    const ErrorIcon = SymbolIcon("alert_fill_16");
    const WarningIcon = SymbolIcon("alert_fill_16");

    return (
        <div
            className={classNames(styles.toast, {
                [styles.toast_warning]: isWarning,
                [styles.toast_error]: isError,
                [styles.toast_exiting]: item.exiting,
            })}
            role="alert"
            aria-live="assertive"
        >
            <div className={styles.toast_icon}>
                {isError ? <ErrorIcon /> : <WarningIcon />}
            </div>
            <div className={styles.toast_content}>
                <div className={styles.toast_target}>{item.record.target}</div>
                <div className={styles.toast_message}>{item.record.message}</div>
                <div className={styles.toast_keyvalues}>
                    {Object.entries(item.record.keyValues).map(([k, v], i) => (
                        <React.Fragment key={i}>
                            <span key={i * 2 + 0} className={styles.toast_kv_key}>{k}</span>
                            <span key={i * 2 + 1} className={styles.toast_kv_value}>{v}</span>
                        </React.Fragment>
                    ))}
                </div>
            </div>
            <IconButton
                className={styles.toast_close}
                onClick={() => onDismiss(item.id)}
                aria-label="Dismiss notification"
            >
                <CloseIcon />
            </IconButton>
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


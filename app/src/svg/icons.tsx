import * as React from 'react';

export interface IIconProps {
    className?: string;
    width?: string;
    height?: string;
    fill?: string;
}

export function TableChartIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <path
                d="M4,3H20A2,2 0 0,1 22,5V20A2,2 0 0,1 20,22H4A2,2 0 0,1 2,20V5A2,2 0 0,1 4,3M4,7V10H8V7H4M10,7V10H14V7H10M20,10V7H16V10H20M4,12V15H8V12H4M4,20H8V17H4V20M10,12V15H14V12H10M10,20H14V17H10V20M20,20V17H16V20H20M20,12H16V15H20V12Z"
                fill={props.fill || '#ffffff'}
                fillRule="nonzero"
            />
        </svg>
    );
}

export function AnalyticsIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <path
                d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-5h2v5zm4 0h-2v-3h2v3zm0-5h-2v-2h2v2zm4 5h-2V7h2v10z"
                fill={props.fill || '#ffffff'}
                fillRule="nonzero"
            />
        </svg>
    );
}

export function BarChartIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <path
                d="M22,21H2V3H4V19H6V10H10V19H12V6H16V19H18V14H22V21Z"
                fill={props.fill || '#ffffff'}
                fillRule="nonzero"
            />
        </svg>
    );
}

export function LineChartIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
            >
            <path
                d="M16,11.78L20.24,4.45L21.97,5.45L16.74,14.5L10.23,10.75L5.46,19H22V21H2V3H4V17.54L9.5,8L16,11.78Z"
                fill={props.fill || '#ffffff'}
                fillRule="nonzero"
            />
        </svg>
    );
}

export function ScatterChartIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g fill={props.fill || '#ffffff'} fillRule="evenodd">
                <path d="M2,2H4V20H22V22H2V2M9,10A3,3 0 0,1 12,13A3,3 0 0,1 9,16A3,3 0 0,1 6,13A3,3 0 0,1 9,10M13,2A3,3 0 0,1 16,5A3,3 0 0,1 13,8A3,3 0 0,1 10,5A3,3 0 0,1 13,2M18,12A3,3 0 0,1 21,15A3,3 0 0,1 18,18A3,3 0 0,1 15,15A3,3 0 0,1 18,12Z" />
            </g>
        </svg>
    );
}

export function InsertChartIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g fill="none" fillRule="evenodd">
                <path
                    d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"
                    fill={props.fill || '#ffffff'}
                    fillRule="nonzero"
                />
            </g>
        </svg>
    );
}

export function ArcChartIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g fill="none" fillRule="evenodd">
                <path
                    d="M16.18,19.6L14.17,16.12C15.15,15.4 15.83,14.28 15.97,13H20C19.83,15.76 18.35,18.16 16.18,19.6M13,7.03V3C17.3,3.26 20.74,6.7 21,11H16.97C16.74,8.91 15.09,7.26 13,7.03M7,12.5C7,13.14 7.13,13.75 7.38,14.3L3.9,16.31C3.32,15.16 3,13.87 3,12.5C3,7.97 6.54,4.27 11,4V8.03C8.75,8.28 7,10.18 7,12.5M11.5,21C8.53,21 5.92,19.5 4.4,17.18L7.88,15.17C8.7,16.28 10,17 11.5,17C12.14,17 12.75,16.87 13.3,16.62L15.31,20.1C14.16,20.68 12.87,21 11.5,21Z"
                    fill={props.fill || '#ffffff'}
                    fillRule="nonzero"
                />
            </g>
        </svg>
    );
}

export function CloseIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g fill="none" fillRule="evenodd">
                <path
                    d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
                    fill={props.fill || '#ffffff'}
                    fillRule="nonzero"
                />
            </g>
        </svg>
    );
}

export function ConsoleIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g fill={props.fill || '#ffffff'} fillRule="evenodd">
                <path d="M13,19V16H21V19H13M8.5,13L2.47,7H6.71L11.67,11.95C12.25,12.54 12.25,13.5 11.67,14.07L6.74,19H2.5L8.5,13Z" />
            </g>
        </svg>
    );
}

export function StatusWarningIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g fill="none" fillRule="evenodd">
                <path
                    d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"
                    fill={props.fill || '#ffffff'}
                    fillRule="nonzero"
                />
            </g>
        </svg>
    );
}

export function PlanIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g fill={props.fill || '#ffffff'} fillRule="evenodd">
                <path d="M8,4.99980749 C8,4.44762906 8.45303631,4 8.99703014,4 L15.0029699,4 C15.5536144,4 16,4.44371665 16,4.99980749 L16,8.00019251 C16,8.55237094 15.5469637,9 15.0029699,9 L8.99703014,9 C8.4463856,9 8,8.55628335 8,8.00019251 L8,4.99980749 Z M2,15.9998075 C2,15.4476291 2.45303631,15 2.99703014,15 L9.00296986,15 C9.5536144,15 10,15.4437166 10,15.9998075 L10,19.0001925 C10,19.5523709 9.54696369,20 9.00296986,20 L2.99703014,20 C2.4463856,20 2,19.5562834 2,19.0001925 L2,15.9998075 Z M14,15.9998075 C14,15.4476291 14.4530363,15 14.9970301,15 L21.0029699,15 C21.5536144,15 22,15.4437166 22,15.9998075 L22,19.0001925 C22,19.5523709 21.5469637,20 21.0029699,20 L14.9970301,20 C14.4463856,20 14,19.5562834 14,19.0001925 L14,15.9998075 Z M11,13 L6,13 L6,14.0189261 L5,14.0189261 L5,12 L10,12 L10,9.99680278 L11,9.99680278 L11,13 Z M14,9.99680278 L14,12 L19,12 L19,14.0189261 L18,14.0189261 L18,13 L13,13 L13,9.99680278 L14,9.99680278 Z" />
            </g>
        </svg>
    );
}

export function StatusScheduledIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g fill={props.fill || '#ffffff'} fillRule="evenodd">
                <path d="M12,2C6.48,2 2,6.48 2,12C2,17.52 6.48,22 12,22C17.52,22 22,17.52 22,12C22,6.48 17.52,2 12,2ZM12.5,7L11,7L11,13L16.25,16.15L17,14.92L12.5,12.25L12.5,7Z" />
            </g>
        </svg>
    );
}

export function StatusSucceededIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g fill={props.fill || '#ffffff'} fillRule="evenodd">
                <path d="M12,2C6.48,2 2,6.48 2,12C2,17.52 6.48,22 12,22C17.52,22 22,17.52 22,12C22,6.48 17.52,2 12,2ZM10,17L6,13L7.41,11.59L10,14.17L16.59,7.58L18,9L10,17Z" />
            </g>
        </svg>
    );
}

export function StatusFailedIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g fill={props.fill || '#ffffff'} fillRule="evenodd">
                <path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z" />
            </g>
        </svg>
    );
}

export function StatusRunningIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g fill={props.fill || '#ffffff'} fillRule="evenodd">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z" />
            </g>
        </svg>
    );
}

export function DatabaseSearchIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g fill={props.fill || '#ffffff'} fillRule="evenodd">
                <path d="M18.68,12.32C16.92,10.56 14.07,10.57 12.32,12.33C10.56,14.09 10.56,16.94 12.32,18.69C13.81,20.17 16.11,20.43 17.89,19.32L21,22.39L22.39,21L19.3,17.89C20.43,16.12 20.17,13.8 18.68,12.32M17.27,17.27C16.29,18.25 14.71,18.24 13.73,17.27C12.76,16.29 12.76,14.71 13.74,13.73C14.71,12.76 16.29,12.76 17.27,13.73C18.24,14.71 18.24,16.29 17.27,17.27M10.9,20.1C10.25,19.44 9.74,18.65 9.42,17.78C6.27,17.25 4,15.76 4,14V17C4,19.21 7.58,21 12,21V21C11.6,20.74 11.23,20.44 10.9,20.1M4,9V12C4,13.68 6.07,15.12 9,15.7C9,15.63 9,15.57 9,15.5C9,14.57 9.2,13.65 9.58,12.81C6.34,12.3 4,10.79 4,9M12,3C7.58,3 4,4.79 4,7C4,9 7,10.68 10.85,11H10.9C12.1,9.74 13.76,9 15.5,9C16.41,9 17.31,9.19 18.14,9.56C19.17,9.09 19.87,8.12 20,7C20,4.79 16.42,3 12,3Z" />
            </g>
            k
        </svg>
    );
}

export function DatabaseImportIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g fill={props.fill || '#ffffff'} fillRule="evenodd">
                <path d="M12,3C8.59,3 5.69,4.07 4.54,5.57L9.79,10.82C10.5,10.93 11.22,11 12,11C16.42,11 20,9.21 20,7C20,4.79 16.42,3 12,3M3.92,7.08L2.5,8.5L5,11H0V13H5L2.5,15.5L3.92,16.92L8.84,12M20,9C20,11.21 16.42,13 12,13C11.34,13 10.7,12.95 10.09,12.87L7.62,15.34C8.88,15.75 10.38,16 12,16C16.42,16 20,14.21 20,12M20,14C20,16.21 16.42,18 12,18C9.72,18 7.67,17.5 6.21,16.75L4.53,18.43C5.68,19.93 8.59,21 12,21C16.42,21 20,19.21 20,17" />
            </g>
        </svg>
    );
}

export function FileDocumentBoxPlusIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g fill={props.fill || '#ffffff'} fillRule="evenodd">
                <path d="M17,14H19V17H22V19H19V22H17V19H14V17H17V14M12,17V15H7V17H12M17,11H7V13H14.69C13.07,14.07 12,15.91 12,18C12,19.09 12.29,20.12 12.8,21H5C3.89,21 3,20.1 3,19V5C3,3.89 3.89,3 5,3H19A2,2 0 0,1 21,5V12.8C20.12,12.29 19.09,12 18,12L17,12.08V11M17,9V7H7V9H17Z" />
            </g>
        </svg>
    );
}

export function FileDownloadIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g fill={props.fill || '#ffffff'} fillRule="evenodd">
                <path d="M14,2H6C4.89,2 4,2.89 4,4V20C4,21.11 4.89,22 6,22H18C19.11,22 20,21.11 20,20V8L14,2M12,19L8,15H10.5V12H13.5V15H16L12,19M13,9V3.5L18.5,9H13Z" />
            </g>
        </svg>
    );
}

export function FileUploadIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g fill={props.fill || '#ffffff'} fillRule="evenodd">
                <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M13.5,16V19H10.5V16H8L12,12L16,16H13.5M13,9V3.5L18.5,9H13Z" />
            </g>
        </svg>
    );
}

export function CursorIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g fill={props.fill || '#ffffff'} fillRule="evenodd">
                <path d="M13.64,21.97C13.14,22.21 12.54,22 12.31,21.5L10.13,16.76L7.62,18.78C7.45,18.92 7.24,19 7,19A1,1 0 0,1 6,18V3A1,1 0 0,1 7,2C7.24,2 7.47,2.09 7.64,2.23L7.65,2.22L19.14,11.86C19.57,12.22 19.62,12.85 19.27,13.27C19.12,13.45 18.91,13.57 18.7,13.61L15.54,14.23L17.74,18.96C18,19.46 17.76,20.05 17.26,20.28L13.64,21.97Z" />
            </g>
        </svg>
    );
}

export function VariableBoxIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g fill={props.fill || '#ffffff'} fillRule="evenodd">
                <path d="M19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3M7.4 18C5.9 16.5 5 14.3 5 12S5.9 7.5 7.4 6L9 6.7C7.7 7.9 7 9.9 7 12S7.7 16.1 9 17.3L7.4 18M12.7 15L11.9 13L10.5 15H9L11.3 11.9L10 9H11.3L12.1 11L13.5 9H15L12.8 12L14.1 15H12.7M16.6 18L15 17.3C16.3 16 17 14.1 17 12S16.3 7.9 15 6.7L16.6 6C18.1 7.5 19 9.7 19 12S18.1 16.5 16.6 18Z" />
            </g>
        </svg>
    );
}

export function TextCardIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g fill={props.fill || '#ffffff'} fillRule="evenodd">
                <path d="M20,20H4A2,2 0 0,1 2,18V6A2,2 0 0,1 4,4H20A2,2 0 0,1 22,6V18A2,2 0 0,1 20,20M5,13V15H16V13H5M5,9V11H19V9H5Z" />
            </g>
        </svg>
    );
}

export function CodeIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g fill={props.fill || '#ffffff'} fillRule="evenodd">
                <path d="M14.6,16.6L19.2,12L14.6,7.4L16,6L22,12L16,18L14.6,16.6M9.4,16.6L4.8,12L9.4,7.4L8,6L2,12L8,18L9.4,16.6Z" />
            </g>
        </svg>
    );
}

export function RefreshIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g fill={props.fill || '#ffffff'} fillRule="evenodd">
                <path d="M17.65,6.35C16.2,4.9 14.21,4 12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20C15.73,20 18.84,17.45 19.73,14H17.65C16.83,16.33 14.61,18 12,18A6,6 0 0,1 6,12A6,6 0 0,1 12,6C13.66,6 15.14,6.69 16.22,7.78L13,11H20V4L17.65,6.35Z" />
            </g>
        </svg>
    );
}

export function CloudUploadIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g fill={props.fill || '#ffffff'} fillRule="evenodd">
                <path d="M14,13V17H10V13H7L12,8L17,13M19.35,10.03C18.67,6.59 15.64,4 12,4C9.11,4 6.6,5.64 5.35,8.03C2.34,8.36 0,10.9 0,14A6,6 0 0,0 6,20H19A5,5 0 0,0 24,15C24,12.36 21.95,10.22 19.35,10.03Z" />
            </g>
        </svg>
    );
}

export function ShareIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g fill={props.fill || '#ffffff'} fillRule="evenodd">
                <path d="M11 9V5L18 12L11 19V14.9C6 14.9 2.5 16.5 0 20C1 15 4 10 11 9M17 8V5L24 12L17 19V16L21 12L17 8Z" />
            </g>
        </svg>
    );
}

export function AddIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g fill={props.fill || '#ffffff'} fillRule="evenodd">
                <path d="M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z" />
            </g>
        </svg>
    );
}

export function AspectRatioIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g fill={props.fill || '#ffffff'} fillRule="evenodd">
                <path d="M19,12H17V15H14V17H19V12M7,9H10V7H5V12H7V9M21,3H3A2,2 0 0,0 1,5V19A2,2 0 0,0 3,21H21A2,2 0 0,0 23,19V5A2,2 0 0,0 21,3M21,19H3V5H21V19Z" />
            </g>
        </svg>
    );
}

export function RulerIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g fill={props.fill || '#ffffff'} fillRule="evenodd">
                <path d="M3,5V21H9V19.5H7V18H9V16.5H5V15H9V13.5H7V12H9V10.5H5V9H9V5H10.5V9H12V7H13.5V9H15V5H16.5V9H18V7H19.5V9H21V3H5A2,2 0 0,0 3,5M6,7A1,1 0 0,1 5,6A1,1 0 0,1 6,5A1,1 0 0,1 7,6A1,1 0 0,1 6,7Z" />
            </g>
        </svg>
    );
}

export function DatabaseIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g fill={props.fill || '#ffffff'} fillRule="evenodd">
                <path d="M12,3C7.58,3 4,4.79 4,7C4,9.21 7.58,11 12,11C16.42,11 20,9.21 20,7C20,4.79 16.42,3 12,3M4,9V12C4,14.21 7.58,16 12,16C16.42,16 20,14.21 20,12V9C20,11.21 16.42,13 12,13C7.58,13 4,11.21 4,9M4,14V17C4,19.21 7.58,21 12,21C16.42,21 20,19.21 20,17V14C20,16.21 16.42,18 12,18C7.58,18 4,16.21 4,14Z" />
            </g>
        </svg>
    );
}

export function GitHubFaceIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g fill={props.fill || '#ffffff'} fillRule="evenodd">
                <path d="M12,2A10,10 0 0,0 2,12C2,16.42 4.87,20.17 8.84,21.5C9.34,21.58 9.5,21.27 9.5,21C9.5,20.77 9.5,20.14 9.5,19.31C6.73,19.91 6.14,17.97 6.14,17.97C5.68,16.81 5.03,16.5 5.03,16.5C4.12,15.88 5.1,15.9 5.1,15.9C6.1,15.97 6.63,16.93 6.63,16.93C7.5,18.45 8.97,18 9.54,17.76C9.63,17.11 9.89,16.67 10.17,16.42C7.95,16.17 5.62,15.31 5.62,11.5C5.62,10.39 6,9.5 6.65,8.79C6.55,8.54 6.2,7.5 6.75,6.15C6.75,6.15 7.59,5.88 9.5,7.17C10.29,6.95 11.15,6.84 12,6.84C12.85,6.84 13.71,6.95 14.5,7.17C16.41,5.88 17.25,6.15 17.25,6.15C17.8,7.5 17.45,8.54 17.35,8.79C18,9.5 18.38,10.39 18.38,11.5C18.38,15.32 16.04,16.16 13.81,16.41C14.17,16.72 14.5,17.33 14.5,18.26C14.5,19.6 14.5,20.68 14.5,21C14.5,21.27 14.66,21.59 15.17,21.5C19.14,20.16 22,16.42 22,12A10,10 0 0,0 12,2Z" />
            </g>
        </svg>
    );
}

export function VariableIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g fill={props.fill || '#ffffff'} fillRule="evenodd">
                <path d="M20.41,3C21.8,5.71 22.35,8.84 22,12C21.8,15.16 20.7,18.29 18.83,21L17.3,20C18.91,17.57 19.85,14.8 20,12C20.34,9.2 19.89,6.43 18.7,4L20.41,3M5.17,3L6.7,4C5.09,6.43 4.15,9.2 4,12C3.66,14.8 4.12,17.57 5.3,20L3.61,21C2.21,18.29 1.65,15.17 2,12C2.2,8.84 3.3,5.71 5.17,3M12.08,10.68L14.4,7.45H16.93L13.15,12.45L15.35,17.37H13.09L11.71,14L9.28,17.33H6.76L10.66,12.21L8.53,7.45H10.8L12.08,10.68Z" />
            </g>
        </svg>
    );
}

export function DeleteIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g fill={props.fill || '#ffffff'} fillRule="evenodd">
                <path d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z" />
            </g>
        </svg>
    );
}

export function EditIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g fill={props.fill || '#ffffff'} fillRule="evenodd">
                <path d="M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.12,5.12L18.87,8.87M3,17.25V21H6.75L17.81,9.93L14.06,6.18L3,17.25Z" />
            </g>
        </svg>
    );
}

export function IconTemplate(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g fill={props.fill || '#ffffff'} fillRule="evenodd"></g>
        </svg>
    );
}

export function ShellIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 20 12"
        >
            <g fill={props.fill || '#ffffff'} fillRule="nonzero">
                <polygon points="0 0 3.03703704 5 0 10 3 10 6 5 3 0" />
                <polygon points="9 8 9 10 18 10 18 8" />
            </g>
        </svg>
    );
}

export function PlayIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <path d="M8 5v14l11-7z" fill={props.fill || '#ffffff'} fillRule="nonzero" />
        </svg>
    );
}

export function UndoIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <path
                d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"
                fill={props.fill || '#ffffff'}
                fillRule="nonzero"
            />
        </svg>
    );
}

export function RedoIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <path
                d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z"
                fill={props.fill || '#ffffff'}
                fillRule="nonzero"
            />
        </svg>
    );
}

export function AutoRunIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <path
                d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"
                fill={props.fill || '#ffffff'}
                fillRule="nonzero"
            />
        </svg>
    );
}

export function CheckIconIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <path
                d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"
                fill={props.fill || '#ffffff'}
                fillRule="nonzero"
            />
        </svg>
    );
}

export function ChevronLeftIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" fill={props.fill || '#ffffff'} fillRule="nonzero" />
        </svg>
    );
}

export function ChevronRightIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <path
                d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"
                fill={props.fill || '#ffffff'}
                fillRule="nonzero"
            />
        </svg>
    );
}

export function ExpandLessIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <path
                d="M12 8l-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z"
                fill={props.fill || '#ffffff'}
                fillRule="nonzero"
            />
        </svg>
    );
}

export function ExpandMoreIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z" fill={props.fill || '#ffffff'} fillRule="nonzero" />
        </svg>
    );
}

export function EyeIcon(props: IIconProps) {
    return (
        <svg
            className={props.className || 'icon'}
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <path
                d="M12,9A3,3 0 0,0 9,12A3,3 0 0,0 12,15A3,3 0 0,0 15,12A3,3 0 0,0 12,9M12,17A5,5 0 0,1 7,12A5,5 0 0,1 12,7A5,5 0 0,1 17,12A5,5 0 0,1 12,17M12,4.5C7,4.5 2.73,7.61 1,12C2.73,16.39 7,19.5 12,19.5C17,19.5 21.27,16.39 23,12C21.27,7.61 17,4.5 12,4.5Z"
                fill={props.fill || '#ffffff'}
                fillRule="nonzero"
            />
        </svg>
    );
}
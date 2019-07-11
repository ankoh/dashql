import * as React from 'react';

interface IIconProps {
    width?: string;
    height?: string;
    fill?: string;
}

export function DeleteIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill="none"
                fillRule="evenodd"
            >
                <path
                    d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"
                    fill={props.fill || '#ffffff'}
                    fillRule="nonzero"
                />
            </g>
        </svg>);
}

export function TableChartIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill="none"
                fillRule="evenodd"
            >
                <path
                    d="M10 10.02h5V21h-5zM17 21h3c1.1 0 2-.9 2-2v-9h-5v11zm3-18H5c-1.1 0-2 .9-2 2v3h19V5c0-1.1-.9-2-2-2zM3 19c0 1.1.9 2 2 2h3V10H3v9z"
                    fill={props.fill || '#ffffff'}
                    fillRule="nonzero"
                />
            </g>
        </svg>);
}

export function BarChartIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill="none"
                fillRule="evenodd"
            >
                <path
                    d="M5 9.2h3V19H5zM10.6 5h2.8v14h-2.8zm5.6 8H19v6h-2.8z"
                    fill={props.fill || '#ffffff'}
                    fillRule="nonzero"
                />
            </g>
        </svg>);
}

export function LineChartIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <path clipPath="url(#b)" d="M23 8c0 1.1-.9 2-2 2-.18 0-.35-.02-.51-.07l-3.56 3.55c.05.16.07.34.07.52 0 1.1-.9 2-2 2s-2-.9-2-2c0-.18.02-.36.07-.52l-2.55-2.55c-.16.05-.34.07-.52.07s-.36-.02-.52-.07l-4.55 4.56c.05.16.07.33.07.51 0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2c.18 0 .35.02.51.07l4.56-4.55C8.02 9.36 8 9.18 8 9c0-1.1.9-2 2-2s2 .9 2 2c0 .18-.02.36-.07.52l2.55 2.55c.16-.05.34-.07.52-.07s.36.02.52.07l3.55-3.56C19.02 8.35 19 8.18 19 8c0-1.1.9-2 2-2s2 .9 2 2z"
                    fill={props.fill || '#ffffff'}
                    fillRule="nonzero"
            />
        </svg>);
}

export function BubbleChartIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill={props.fill || '#ffffff'}
                fillRule="evenodd"
            >
                <circle cx="7.2" cy="14.4" r="3.2" />
                <circle cx="14.8" cy="18" r="2" />
                <circle cx="15.2" cy="8.8" r="4.8" />
            </g>
        </svg>);
}

export function InsertChartIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill="none"
                fillRule="evenodd"
            >
                <path
                    d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"
                    fill={props.fill || '#ffffff'}
                    fillRule="nonzero"
                />
            </g>
        </svg>);
}

export function PieChartIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill="none"
                fillRule="evenodd"
            >
                <path
                    d="M11 2v20c-5.07-.5-9-4.79-9-10s3.93-9.5 9-10zm2.03 0v8.99H22c-.47-4.74-4.24-8.52-8.97-8.99zm0 11.01V22c4.74-.47 8.5-4.25 8.97-8.99h-8.97z"
                    fill={props.fill || '#ffffff'}
                    fillRule="nonzero"
                />
            </g>
        </svg>);
}

export function CloseIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill="none"
                fillRule="evenodd"
            >
                <path
                    d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
                    fill={props.fill || '#ffffff'}
                    fillRule="nonzero"
                />
            </g>
        </svg>);
}

export function ServerIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill="none"
                fillRule="evenodd"
            >
                <path
                    d="M20 13H4c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1h16c.55 0 1-.45 1-1v-6c0-.55-.45-1-1-1zM7 19c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zM20 3H4c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1h16c.55 0 1-.45 1-1V4c0-.55-.45-1-1-1zM7 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"
                    fill={props.fill || '#ffffff'}
                    fillRule="nonzero"
                />
            </g>
        </svg>);
}

export function LinkOffIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill="none"
                fillRule="evenodd"
            >
                <path
                    d="M17 7h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1 0 1.43-.98 2.63-2.31 2.98l1.46 1.46C20.88 15.61 22 13.95 22 12c0-2.76-2.24-5-5-5zm-1 4h-2.19l2 2H16zM2 4.27l3.11 3.11C3.29 8.12 2 9.91 2 12c0 2.76 2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1 0-1.59 1.21-2.9 2.76-3.07L8.73 11H8v2h2.73L13 15.27V17h1.73l4.01 4L20 19.74 3.27 3 2 4.27z"
                    fill={props.fill || '#ffffff'}
                    fillRule="nonzero"
                />
            </g>
        </svg>);
}

export function PlayIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill="none"
                fillRule="evenodd"
            >
                <path
                    d="M8 5v14l11-7z"
                    fill={props.fill || '#ffffff'}
                    fillRule="nonzero"
                />
            </g>
        </svg>);
}

export function StopIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill="none"
                fillRule="evenodd"
            >
                <path
                    d="M6 6h12v12H6z"
                    fill={props.fill || '#ffffff'}
                    fillRule="nonzero"
                />
            </g>
        </svg>);
}


export function ClearIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill="none"
                fillRule="evenodd"
            >
                <path
                    d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
                    fill={props.fill || '#ffffff'}
                    fillRule="nonzero"
                />
            </g>
        </svg>);
}

export function ClearAllIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill="none"
                fillRule="evenodd"
            >
                <path
                    d="M5 13h14v-2H5v2zm-2 4h14v-2H3v2zM7 7v2h14V7H7z"
                    fill={props.fill || '#ffffff'}
                    fillRule="nonzero"
                />
            </g>
        </svg>);
}

export function SaveIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill="none"
                fillRule="evenodd"
            >
                <path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"
                    fill={props.fill || '#ffffff'}
                    fillRule="nonzero"
                />
            </g>
        </svg>);
}


export function UndoIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill="none"
                fillRule="evenodd"
            >
                <path
                    d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"
                    fill={props.fill || '#ffffff'}
                    fillRule="nonzero"
                />
            </g>
        </svg>);
}

interface IProgramIIconProps {
    width?: string;
    height?: string;
    fill?: string;
    stroke?: string;
}

export function ProgramIcon(props: IProgramIIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill={props.fill || '#ffffff'}
                fillRule="evenodd"
            >
                <path d="M0 0h24v24H0z" fill="none"/>
                <path d="M3 18h6v-2H3v2zM3 6v2h18V6H3zm0 7h12v-2H3v2z"/>
            </g>
        </svg>);
}

export function ConsoleIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill={props.fill || '#ffffff'}
                fillRule="evenodd"
                transform="translate(3.000000, 7.000000)"
            >
                <polygon points="0 0 3.03703704 5 0 10 3 10 6 5 3 0" />
                <polygon points="9 8 9 10 18 10 18 8" />
            </g>
        </svg>);
}

export function WarningIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill="none"
                fillRule="evenodd"
            >
                <path
                    d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"
                    fill={props.fill || '#ffffff'}
                    fillRule="nonzero"
                />
            </g>
        </svg>);
}

export function ErrorIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill="none"
                fillRule="evenodd"
            >
                <path
                    d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"
                    fill={props.fill || '#ffffff'}
                    fillRule="nonzero"
                />
            </g>
        </svg>);
}

export function ZoomInIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill={props.fill || '#ffffff'}
                fillRule="evenodd"
            >
                <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                <path d="M0 0h24v24H0V0z" fill="none"/>
                <path d="M12 10h-2v2H9v-2H7V9h2V7h1v2h2v1z"/>
            </g>
        </svg>);
}

export function ZoomOutIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill={props.fill || '#ffffff'}
                fillRule="evenodd"
            >
                <path d="M0 0h24v24H0V0z" fill="none"/>
                <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14zM7 9h5v1H7z"/>
            </g>
        </svg>);
}

export function FullscreenIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill={props.fill || '#ffffff'}
                fillRule="evenodd"
            >
                <path d="M0 0h24v24H0z" fill="none"/>
                <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
            </g>

        </svg>);
}

export function MoveIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill={props.fill || '#ffffff'}
                fillRule="evenodd"
            >
                <path d="M10 9h4V6h3l-5-5-5 5h3v3zm-1 1H6V7l-5 5 5 5v-3h3v-4zm14 2l-5-5v3h-3v4h3v3l5-5zm-9 3h-4v3H7l5 5 5-5h-3v-3z"/>
                <path d="M0 0h24v24H0z" fill="none"/>
            </g>

        </svg>);
}

export function PanIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill={props.fill || '#ffffff'}
                fillRule="evenodd"
            >
                <defs>
                    <path d="M0 0h24v24H0z" id="a"/>
                </defs>
                <clipPath id="b">
                    <use overflow="visible" xlinkHref="#a"/>
                </clipPath>
                <path clipPath="url(#b)" d="M23 5.5V20c0 2.2-1.8 4-4 4h-7.3c-1.08 0-2.1-.43-2.85-1.19L1 14.83s1.26-1.23 1.3-1.25c.22-.19.49-.29.79-.29.22 0 .42.06.6.16.04.01 4.31 2.46 4.31 2.46V4c0-.83.67-1.5 1.5-1.5S11 3.17 11 4v7h1V1.5c0-.83.67-1.5 1.5-1.5S15 .67 15 1.5V11h1V2.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5V11h1V5.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5z"/>
            </g>

        </svg>);
}

export function CardinalityIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill={props.fill || '#ffffff'}
                fillRule="evenodd"
            >
                <path d="M0 0h24v24H0z" fill="none" />
                <path d="M 7,20.41 5.59,19 9,15.59 10.41,17 Z M 16.5,8 H 13 v 5.59 L 18.41,19 17,20.41 l -6,-6 V 8 H 7.5 L 12,3.5 Z" />
            </g>

        </svg>);
}

export function MoreHIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill={props.fill || '#ffffff'}
                fillRule="evenodd"
            >
                <path d="M0 0h24v24H0z" fill="none"/>
                <path d="M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
            </g>

        </svg>);
}

export function LinkIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill={props.fill || '#ffffff'}
                fillRule="evenodd"
            >
                <path d="M0 0h24v24H0z" fill="none"/>
                <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/>
            </g>
        </svg>);
}

export function ScrollTopIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill={props.fill || '#ffffff'}
                fillRule="evenodd"
            >
                <path d="m 7.205,18.205 4.59,-4.59 4.59,4.59 1.41,-1.41 -6,-6 -6,6 z M 5.795,7.795 v -2 h 12 v 2 z" />
                <path d="M0 0h24v24H0V0z" fill="none" />
            </g>
        </svg>);
}

export function ScrollBottomIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill={props.fill || '#ffffff'}
                fillRule="evenodd"
            >
                <path d="m 7.205,5.795 4.59,4.59 4.59,-4.59 1.41,1.41 -6,6 -6,-6 z m -1.41,10.41 v 2 h 12 v -2 z" />
                <path d="M0 0h24v24H0V0z" fill="none" />
            </g>
        </svg>);
}

export function ScrollUpIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill={props.fill || '#ffffff'}
                fillRule="evenodd"
            >
                <path d="M12 8l-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z"/>
                <path d="M0 0h24v24H0z" fill="none"/>
            </g>
        </svg>);
}

export function ScrollDownIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill={props.fill || '#ffffff'}
                fillRule="evenodd"
            >
                <path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z"/>
                <path d="M0 0h24v24H0z" fill="none"/>
            </g>
        </svg>);
}

export function LaptopIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill={props.fill || '#ffffff'}
                fillRule="evenodd"
            >
                <path d="M20 18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z"/>
                <path d="M0 0h24v24H0z" fill="none"/>
            </g>
        </svg>);
}

export function ArrowBackIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill={props.fill || '#ffffff'}
                fillRule="evenodd"
            >
                <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
                <path d="M0 0h24v24H0z" fill="none"/>
            </g>
        </svg>);
}

export function ArrowBackIosIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill={props.fill || '#ffffff'}
                fillRule="evenodd"
            >
                <path d="M11.67 3.87L9.9 2.1 0 12l9.9 9.9 1.77-1.77L3.54 12z" />
                <path d="M0 0h24v24H0z" fill="none"/>
            </g>
        </svg>);
}

export function ArrowForwardIosIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill={props.fill || '#ffffff'}
                fillRule="evenodd"
            >
                <path d="M5.88 4.12L13.76 12l-7.88 7.88L8 22l10-10L8 2z" />
                <path d="M0 0h24v24H0z" fill="none"/>
            </g>
        </svg>);
}

export function DataTransferIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill={props.fill || '#ffffff'}
                fillRule="evenodd"
            >
                <path d="M16 17.01V10h-2v7.01h-3L15 21l4-3.99h-3zM9 3L5 6.99h3V14h2V6.99h3L9 3z"/>
                <path d="M0 0h24v24H0z" fill="none"/>
            </g>
        </svg>);
}

export function DataTransferCircleIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill={props.fill || '#ffffff'}
                fillRule="evenodd"
            >
                <circle cx="12" cy="19" r="2"/>
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM6.5 9L10 5.5 13.5 9H11v4H9V9H6.5zm11 6L14 18.5 10.5 15H13v-4h2v4h2.5z"/>
                <path d="M0 0h24v24H0z" fill="none"/>
            </g>
        </svg>);
}

export function PriorityHighIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill={props.fill || '#ffffff'}
                fillRule="evenodd"
            >
                <circle cx="12" cy="19" r="2"/>
                <path d="M10 3h4v12h-4z"/>
                <path d="M0 0h24v24H0z" fill="none"/>
            </g>
        </svg>);
}

export function GlobeWireframeIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill={props.fill || '#ffffff'}
                fillRule="evenodd"
            >
                <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm6.93 6h-2.95c-.32-1.25-.78-2.45-1.38-3.56 1.84.63 3.37 1.91 4.33 3.56zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2 0 .68.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56-1.84-.63-3.37-1.9-4.33-3.56zm2.95-8H5.08c.96-1.66 2.49-2.93 4.33-3.56C8.81 5.55 8.35 6.75 8.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2 0-.68.07-1.35.16-2h4.68c.09.65.16 1.32.16 2 0 .68-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95c-.96 1.65-2.49 2.93-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2 0-.68-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z"/>
                <path d="M0 0h24v24H0z" fill="none"/>
            </g>
        </svg>);
}

export function GlobeIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill={props.fill || '#ffffff'}
                fillRule="evenodd"
            >
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
                <path d="M0 0h24v24H0z" fill="none"/>
            </g>
        </svg>);
}

export function FireIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill={props.fill || '#ffffff'}
                fillRule="evenodd"
            >
                <path d="M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z"/>
                <path d="M0 0h24v24H0z" fill="none"/>
            </g>
        </svg>);
}

export function AddIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill={props.fill || '#ffffff'}
                fillRule="evenodd"
            >
                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                <path d="M0 0h24v24H0z" fill="none"/>
            </g>
        </svg>);
}

export function SettingsIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill={props.fill || '#ffffff'}
                fillRule="evenodd"
            >
                <path d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"/>
                <path d="M0 0h24v24H0z" fill="none"/>
            </g>
        </svg>);
}

export function EditIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill={props.fill || '#ffffff'}
                fillRule="evenodd"
            >
                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                <path d="M0 0h24v24H0z" fill="none"/>
            </g>
        </svg>);
}

export function PlanIcon(props: IIconProps) {
    return (
        <svg
            width={props.width || '24px'}
            height={props.height || '24px'}
            viewBox="0 0 24 24"
        >
            <g
                fill={props.fill || '#ffffff'}
                fillRule="evenodd"
            >
                <path d="M8,4.99980749 C8,4.44762906 8.45303631,4 8.99703014,4 L15.0029699,4 C15.5536144,4 16,4.44371665 16,4.99980749 L16,8.00019251 C16,8.55237094 15.5469637,9 15.0029699,9 L8.99703014,9 C8.4463856,9 8,8.55628335 8,8.00019251 L8,4.99980749 Z M2,15.9998075 C2,15.4476291 2.45303631,15 2.99703014,15 L9.00296986,15 C9.5536144,15 10,15.4437166 10,15.9998075 L10,19.0001925 C10,19.5523709 9.54696369,20 9.00296986,20 L2.99703014,20 C2.4463856,20 2,19.5562834 2,19.0001925 L2,15.9998075 Z M14,15.9998075 C14,15.4476291 14.4530363,15 14.9970301,15 L21.0029699,15 C21.5536144,15 22,15.4437166 22,15.9998075 L22,19.0001925 C22,19.5523709 21.5469637,20 21.0029699,20 L14.9970301,20 C14.4463856,20 14,19.5562834 14,19.0001925 L14,15.9998075 Z M11,13 L6,13 L6,14.0189261 L5,14.0189261 L5,12 L10,12 L10,9.99680278 L11,9.99680278 L11,13 Z M14,9.99680278 L14,12 L19,12 L19,14.0189261 L18,14.0189261 L18,13 L13,13 L13,9.99680278 L14,9.99680278 Z" />
                <path d="M0 0h24v24H0z" fill="none"/>
            </g>
        </svg>);
}

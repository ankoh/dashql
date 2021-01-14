import * as React from 'react';

interface ILogoProps {
    className?: string;
    width?: string;
    height?: string;
    fill?: string;
}

export function DashQLLogo(props: ILogoProps) {
    return (
        <svg
            className={props.className || 'logo'}
            width={props.width || '50px'}
            height={props.height || '50px'}
            viewBox="0 0 50 50"
            fillRule="evenodd"
            clipRule="evenodd"
            strokeLinejoin="round"
            strokeMiterlimit="2"
        >
            <defs>
                <linearGradient id="_Linear1" x1="0" y1="0" x2="1" y2="0" gradientUnits="userSpaceOnUse" gradientTransform="matrix(-285.093,-0.276718,0.276718,-285.093,473.205,300.277)">
                    <stop offset="0" stopColor="rgb(253,204,46)" stopOpacity="1" />
                    <stop offset="1" stopColor="rgb(253,148,53)" stopOpacity="1" />
                </linearGradient>
            </defs>
            <g transform="matrix(0.122221,0,0,0.122221,-9.02013,-11.6432)">
                <path d="M473.205,300C473.205,366.667 184.53,533.333 126.795,500C69.06,466.667 69.06,133.333 126.795,100C184.53,66.667 473.205,233.333 473.205,300ZM203.5,231.786C223.467,220.397 322.527,277.589 322.372,300.417C322.218,323.244 222.384,380.188 202.572,368.75C182.76,357.312 183.533,243.175 203.5,231.786Z"
                fill="url(#_Linear1)"
            />
            </g>
        </svg>
    );
}

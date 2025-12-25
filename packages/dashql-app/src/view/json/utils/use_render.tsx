import * as React from 'react';
import { useEffect } from 'react';
import { useSymbolsDispatch, type SymbolsElement, type TagType } from '../store/symbols.js';
import { useSectionDispatch, type SectionElement } from '../store/section.js';

export function useSymbolsRender<K extends TagType>(
    currentProps: SymbolsElement<TagType>,
    props: SymbolsElement<K>,
    key: string,
) {
    const dispatch = useSymbolsDispatch();
    const cls = [currentProps.className, props.className].filter(Boolean).join(' ');
    const reset = {
        ...currentProps,
        ...props,
        className: cls,
        style: {
            ...currentProps.style,
            ...props.style,
        },
        children: props.children || currentProps.children,
    };
    useEffect(() => dispatch({ [key]: reset }), [props]);
}

export function useSectionRender<K extends TagType>(
    currentProps: SectionElement<TagType>,
    props: SectionElement<K>,
    key: string,
) {
    const dispatch = useSectionDispatch();
    const cls = [currentProps.className, props.className].filter(Boolean).join(' ');
    const reset = {
        ...currentProps,
        ...props,
        className: cls,
        style: {
            ...currentProps.style,
            ...props.style,
        },
        children: props.children || currentProps.children,
    };
    useEffect(() => dispatch({ [key]: reset }), [props]);
}

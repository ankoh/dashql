import { useEffect } from 'react';
import { useSectionDispatch, type SectionElement, type TagType } from '../store/section.js';

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

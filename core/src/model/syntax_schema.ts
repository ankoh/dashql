import * as proto from "@dashql/proto";

export enum SpecType {
    BOOL_SPEC = 'BOOL_SPEC',
    NUMBER_SPEC = 'NUMBER_SPEC',
    STRING_SPEC = 'STRING_SPEC',
    ARRAY_SPEC = 'ARRAY_SPEC',
    ENUM_SPEC = 'ENUM_SPEC',
    OPTION_SPEC = 'OPTION_SPEC',
    OBJECT_SPEC = 'OBJECT_SPEC',
}

export enum Matching {
    MISSING,
    TYPE_MISMATCH,
    MATCHED
}

interface Spec<NODE_TYPE, VALUE_TYPE> {
    readonly specType: NODE_TYPE;
    readonly nodeType: proto.syntax.NodeType | null;
    matching: Matching;
    value: VALUE_TYPE;
}

export type NodeSchema =
    | Spec<SpecType.BOOL_SPEC, boolean>
    | Spec<SpecType.NUMBER_SPEC, number>
    | Spec<SpecType.STRING_SPEC, string>
    | Spec<SpecType.ARRAY_SPEC, NodeSchema[]>
    | Spec<SpecType.ENUM_SPEC, number>
    | Spec<SpecType.OPTION_SPEC, ObjectSchema>
    | Spec<SpecType.OBJECT_SPEC, ObjectSchema>
    ;

type ObjectSchema = {
    readonly [key in proto.syntax.AttributeKey]?: NodeSchema;
}

export function numberNode(value = 0): NodeSchema {
    return {
        specType: SpecType.NUMBER_SPEC,
        nodeType: proto.syntax.NodeType.UI32,
        matching: Matching.MISSING,
        value: value,
    };
}

export function booleanNode(value: boolean = false): NodeSchema {
    return {
        specType: SpecType.BOOL_SPEC,
        nodeType: proto.syntax.NodeType.BOOL,
        matching: Matching.MISSING,
        value: value,
    };
}

export function stringNode(value: string = ""): NodeSchema {
    return {
        specType: SpecType.STRING_SPEC,
        nodeType: null,
        matching: Matching.MISSING,
        value: value,
    };
}

export function enumNode(enumType: proto.syntax.NodeType, defaultValue: number = 0): NodeSchema {
    return {
        specType: SpecType.ENUM_SPEC,
        nodeType: enumType,
        matching: Matching.MISSING,
        value: defaultValue,
    };
}

export function arrayNode(elementSchemas: NodeSchema[]): NodeSchema {
    return {
        specType: SpecType.ARRAY_SPEC,
        nodeType: proto.syntax.NodeType.ARRAY,
        matching: Matching.MISSING,
        value: elementSchemas,
    };
}

export function optionNode(objectSchema: ObjectSchema): NodeSchema {
    return {
        specType: SpecType.OPTION_SPEC,
        nodeType: null,
        matching: Matching.MISSING,
        value: objectSchema,
    };
}

export function objectNode(objecType: proto.syntax.NodeType, objectSchema: ObjectSchema): NodeSchema {
    return {
        specType: SpecType.OBJECT_SPEC,
        nodeType: objecType,
        matching: Matching.MISSING,
        value: objectSchema,
    };
}

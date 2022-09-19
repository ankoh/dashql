import { Card } from './board_card';

export type IndirectionName = {
    type: 'Name';
    content: string;
};
export type IndirectionIndex = {
    type: 'Index';
    content: {
        value: number;
    };
};
export type IndirectionBounds = {
    type: 'Bounds';
    content: {
        lower_bound?: number;
        upper_bound?: number;
    };
};

export type Indirection = IndirectionName | IndirectionIndex | IndirectionBounds;
export type NamePath = Indirection[];

export interface StatementDependency {
    /// The dependency source node
    /// If A depends on B, then B is the source and A is the target.
    source_stmt: number;
    /// The dependency target node
    target_stmt: number;
    /// The node that creates the dependency
    target_node: number;
}

export enum NodeErrorCode {
    ExpressionEvaluationFailed,
    InvalidInput,
    InvalidValueType,
}

export interface NodeError {
    /// The node id
    node_id?: number;
    /// The error code
    error_code: NodeErrorCode;
    /// The error message
    error_message: number;
}

export interface NodeLinterMessage {
    /// The node id
    node_id: number;
    /// The linter message
    message: string;
}

export interface ProgramAnalysis {
    /// The instance id
    readonly instance_id: number;
    /// The program id
    readonly program_id: number;
    /// The dependencies
    readonly statement_dependencies: StatementDependency[];
    /// The statement names
    readonly statement_names: NamePath[][];
    /// The statement liveness
    readonly statement_liveness: boolean[];
    /// The node error messages
    readonly node_error_messages: NodeError[];
    /// The node linter messages
    readonly node_linter_messages: NodeLinterMessage[];
    /// The cards
    readonly cards: { [key: number]: Card };
}

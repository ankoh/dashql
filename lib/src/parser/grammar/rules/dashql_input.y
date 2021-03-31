dashql_input:
    INPUT dashql_statement_name TYPE_P sql_typename USING dashql_input_component_type opt_dashql_options { 
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_DASHQL_INPUT, concat(NodeVector{
            Key::DASHQL_STATEMENT_NAME << $2,
            Key::DASHQL_INPUT_VALUE_TYPE << $4,
            Key::DASHQL_INPUT_COMPONENT_TYPE << $6,
        }, move($7)));
    }
    ;

dashql_input_component_type:
    TEXT { $$ = Enum(@$, sx::InputComponentType::TEXT); }
  | FILE { $$ = Enum(@$, sx::InputComponentType::FILE); }
    ;

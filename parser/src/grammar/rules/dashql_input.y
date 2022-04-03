dashql_input:
    INPUT dashql_statement_name TYPE_P sql_typename opt_dashql_input_using { 
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_DASHQL_INPUT, Concat(NodeVector{
            Attr(Key::DASHQL_STATEMENT_NAME, $2),
            Attr(Key::DASHQL_INPUT_VALUE_TYPE, $4)
        }, std::move($5)));
    }
    ;

opt_dashql_input_using:
    USING dashql_input_component { $$ = std::move($2); }
  | %empty {
        $$ = {
            Attr(Key::DASHQL_INPUT_COMPONENT_TYPE, Enum(@$, sx::InputComponentType::NONE))
        };
    }
    ;

dashql_input_component:
    dashql_input_component_type opt_dson {
        $$ = Concat(NodeVector{
            Attr(Key::DASHQL_INPUT_COMPONENT_TYPE, $1),
        }, std::move($2));
    }
  | opt_dson {
        $$ = Concat(NodeVector{
            Attr(Key::DASHQL_INPUT_COMPONENT_TYPE, Enum(@$, sx::InputComponentType::NONE))
        }, std::move($1));
    }
    ;

dashql_input_component_type:
    TEXT     { $$ = Enum(@$, sx::InputComponentType::TEXT); }
  | CALENDAR { $$ = Enum(@$, sx::InputComponentType::CALENDAR); }
    ;

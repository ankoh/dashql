dashql_declare:
    DECLARE dashql_statement_name AS sql_typename opt_dashql_declare_using { 
        $$ = ctx.Add(@$, proto::NodeType::OBJECT_DASHQL_DECLARE, Concat(NodeVector{
            Attr(Key::DASHQL_STATEMENT_NAME, $2),
            Attr(Key::DASHQL_DECLARE_VALUE_TYPE, $4)
        }, std::move($5)));
    }
    ;

opt_dashql_declare_using:
    USING dashql_declare_component { $$ = std::move($2); }
  | %empty {
        $$ = {
            Attr(Key::DASHQL_DECLARE_COMPONENT_TYPE, Enum(@$, proto::InputComponentType::NONE))
        };
    }
    ;

dashql_declare_component:
    dashql_declare_component_type opt_dson {
        $$ = { 
            Attr(Key::DASHQL_DECLARE_COMPONENT_TYPE, $1),
            Attr(Key::DASHQL_DECLARE_EXTRA, std::move($2)),
        };
    }
  | opt_dson {
        $$ = {
            Attr(Key::DASHQL_DECLARE_COMPONENT_TYPE, Enum(@$, proto::InputComponentType::NONE)),
            Attr(Key::DASHQL_DECLARE_EXTRA, std::move($1)),
        };
    }
    ;

dashql_declare_component_type:
    TEXT     { $$ = Enum(@$, proto::InputComponentType::TEXT); }
  | CALENDAR { $$ = Enum(@$, proto::InputComponentType::CALENDAR); }
    ;

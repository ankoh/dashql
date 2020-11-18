dashql_parameter_declaration:
    DECLARE PARAMETER dashql_statement_name TYPE_P dashql_parameter_type opt_dashql_options { 
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_DASHQL_PARAMETER, concat(NodeVector{
            Key::DASHQL_STATEMENT_NAME << $3,
            Key::DASHQL_PARAMETER_TYPE << $5,
        }, move($6)));
    }
    ;

dashql_parameter_type:
    INTEGER     { $$ = Enum(@$, sxd::ParameterType::INTEGER); }
  | FLOAT       { $$ = Enum(@$, sxd::ParameterType::FLOAT); }
  | TEXT        { $$ = Enum(@$, sxd::ParameterType::TEXT); }
  | DATE        { $$ = Enum(@$, sxd::ParameterType::DATE); }
  | DATETIME    { $$ = Enum(@$, sxd::ParameterType::DATETIME); }
  | TIME        { $$ = Enum(@$, sxd::ParameterType::TIME); }
  | FILE        { $$ = Enum(@$, sxd::ParameterType::FILE); }
    ;

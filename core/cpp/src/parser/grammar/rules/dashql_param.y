dashql_parameter_declaration:
    DECLARE PARAMETER dashql_identifier dashql_opt_alias TYPE_P dashql_parameter_type opt_dashql_object {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_DASHQL_PARAMTER, {
            Key::DASHQL_PARAMETER_IDENTIFIER << String(@3),
            Key::DASHQL_PARAMETER_ALIAS << $4,
            Key::DASHQL_PARAMETER_TYPE << $6,
        });
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

dashql_parameter_declaration:
    DECLARE PARAMETER dashql_identifier dashql_opt_alias TYPE_P dashql_parameter_type  {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_DASHQL_PARAMTER, {
            Key::DASHQL_PARAMETER_IDENTIFIER << ctx.Ref(@3),
            Key::DASHQL_PARAMETER_ALIAS << $4,
            Key::DASHQL_PARAMETER_TYPE << $6,
        });
    }
    ;

dashql_parameter_type:
    INTEGER     { $$ = EnumNode(@$, sxd::ParameterType::INTEGER); }
  | FLOAT       { $$ = EnumNode(@$, sxd::ParameterType::FLOAT); }
  | TEXT        { $$ = EnumNode(@$, sxd::ParameterType::TEXT); }
  | DATE        { $$ = EnumNode(@$, sxd::ParameterType::DATE); }
  | DATETIME    { $$ = EnumNode(@$, sxd::ParameterType::DATETIME); }
  | TIME        { $$ = EnumNode(@$, sxd::ParameterType::TIME); }
  | FILE        { $$ = EnumNode(@$, sxd::ParameterType::FILE); }
    ;


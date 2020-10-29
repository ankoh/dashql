dashql_identifier:
    IDENTIFIER_LITERAL  { $$ = Value(@1, ValueType::STRING, 0); }
  | STRING_LITERAL      { $$ = Value(@1, ValueType::STRING, 0); }
    ;

dashql_boolean_value:
    BOOLEAN_LITERAL     { $$ = Value(@1, ValueType::NUMBER, $1); }
    ;

dashql_string_value:
    STRING_LITERAL      { $$ = Value(@1, ValueType::STRING, 0); }
    ;

dashql_opt_alias:
    %empty                  { $$ = std::nullopt; }
  | AS dashql_identifier    { $$ = $2; }
    ;

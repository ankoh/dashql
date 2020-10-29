identifier:
    IDENTIFIER_LITERAL  { $$ = Value(@1.encode(), ValueType::STRING, 0); }
  | STRING_LITERAL      { $$ = Value(@1.encode(), ValueType::STRING, 0); }
    ;

boolean_value:
    BOOLEAN_LITERAL     { $$ = Value(@1.encode(), ValueType::NUMBER, $1); }
    ;

string_value:
    STRING_LITERAL      { $$ = Value(@1.encode(), ValueType::STRING, 0); }
    ;

opt_alias:
    %empty          { $$ = std::nullopt; }
  | AS identifier   { $$ = $2; }
    ;

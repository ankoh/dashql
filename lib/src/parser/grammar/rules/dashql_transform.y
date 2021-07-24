dashql_transform_statement:
    TRANSFORM dashql_statement_ref INTO dashql_statement_name opt_dashql_transform_method opt_dashql_options {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_DASHQL_TRANSFORM, concat(NodeVector{
            Key::DASHQL_STATEMENT_NAME << $4,
            Key::DASHQL_DATA_SOURCE << $2,
            Key::DASHQL_TRANSFORM_METHOD << $5
        }, move($6)));
    }
    ;

opt_dashql_transform_method:
    USING dashql_transform_method_type    { $$ = $2; }
  | %empty                              { $$ = Null(); }

dashql_transform_method_type:
    JMESPATH  { $$ = Enum(@$, sx::TransformMethodType::JMESPATH); }
    ;

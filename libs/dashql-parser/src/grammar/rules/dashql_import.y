dashql_import_statement:
    IMPORT_P dashql_statement_name FROM dashql_import_method opt_dson {
        $$ = ctx.Add(@$, proto::NodeType::OBJECT_DASHQL_IMPORT, {
            Attr(Key::DASHQL_STATEMENT_NAME, $2),
            $4,
            Attr(Key::DASHQL_IMPORT_EXTRA, std::move($5)),
        });
    }
    ;

dashql_import_method:
    HTTP    { $$ = Attr(Key::DASHQL_IMPORT_METHOD, Enum(@$, proto::ImportMethodType::HTTP)); }
  | FILE    { $$ = Attr(Key::DASHQL_IMPORT_METHOD, Enum(@$, proto::ImportMethodType::FILE)); }
  | SCONST  { $$ = Attr(Key::DASHQL_IMPORT_FROM_URI, Const(@1, proto::AConstType::STRING)); }
    ;

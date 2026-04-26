// ---------------------------------------------------------------------------
// VISUALISE extension.
//
// Shape:
//
//   VISUALISE [(SELECT ...) | TABLE <qualified_name>]
//     DRAW <geom> [FROM (<select>)] [PARTITION BY ...]
//                 [REMAP (<target>, ...)] [USING (...)]
//     SCALE [<type>][(<opt>, ...)] <aesthetic>
//       [FROM <bracket-array>] [TO <bracket-array>]
//       [FORMAT (lambda x: <expr>)] [USING (...)]
//       where each <opt> is `<name> => <value>` or a bare `lambda <p>: <expr>`
//     FACET <cols> [BY <cols>] [USING (...)]
//     PROJECT [<aesthetics>] TO <type> [USING (...)]
//     LABEL USING (...)
//
// All expression-bearing sub-clauses are surrounded by parens so they do
// not absorb the keywords that start the next clause.

vis_visualise_keyword:
    VISUALISE  { $$ = $1; }
  | VISUALIZE  { $$ = $1; }
    ;

vis_visualise_stmt:
    vis_visualise_keyword
        vis_opt_visualise_select
        vis_clause_list {
        if (!ctx.IsVisEnabled()) {
            error(@1, "VISUALISE syntax is disabled in this ParseContext");
            YYERROR;
        }
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_VIS_VISUALISE, {
            Attr(Key::VIS_VISUALISE_SELECT, $2),
            Attr(Key::VIS_VISUALISE_CLAUSES, ctx.Array(@3, std::move($3))),
        }, false);
    }
    ;

vis_opt_visualise_select:
    LRB sql_select_stmt RRB {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_SELECT, std::move($2));
    }
  | TABLE sql_relation_expr {
        auto table = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_TABLEREF, std::move($2));
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_SELECT, {
            Attr(Key::SQL_SELECT_TABLE, std::move(table)),
        });
    }
  | %empty { $$ = Null(); }
    ;

// ---------------------------------------------------------------------------
// Clause list

vis_clause_list:
    %empty                         { $$ = ctx.List(); }
  | vis_clause_list vis_clause     { $1->push_back($2); $$ = std::move($1); }
    ;

vis_clause:
    vis_draw_clause     { $$ = $1; }
  | vis_scale_clause    { $$ = $1; }
  | vis_facet_clause    { $$ = $1; }
  | vis_project_clause  { $$ = $1; }
  | vis_label_clause    { $$ = $1; }
    ;

// ---------------------------------------------------------------------------
// Shared helpers

vis_geom:
    sql_col_id  { $$ = vis::GeomEnum(ctx, @1); }
    ;

// USING (option_list). Uses `key => value` syntax.
vis_opt_using:
    USING LRB vis_option_list RRB  { $$ = ctx.Array(@$, std::move($3)); }
  | %empty                         { $$ = Null(); }
    ;

vis_option_list:
    vis_option                           { $$ = ctx.List({ $1 }); }
  | vis_option_list COMMA vis_option     { $1->push_back($3); $$ = std::move($1); }
    ;

vis_option:
    sql_col_id EQUALS_GREATER vararg_value {
        $$ = VarArgField(ctx, @$, ctx.List({ $1 }), $3);
    }
    ;

vis_identifier_list:
    IDENT                               { $$ = ctx.List({ NameFromIdentifier(@1, $1) }); }
  | vis_identifier_list COMMA IDENT     { $1->push_back(NameFromIdentifier(@3, $3)); $$ = std::move($1); }
    ;

// ---------------------------------------------------------------------------
// DRAW
//
//   DRAW <geom> [FROM (<select>)] [PARTITION BY <ident>, ...]
//                                 [REMAP (<target>, ...)] [USING (...)]
//
// Inside `FROM (...)` we accept a full SQL select statement. PARTITION BY is a
// ggsql layer-level concept (not part of SELECT) and lives as its own DRAW
// sub-clause.

vis_draw_clause:
    DRAW vis_geom vis_opt_draw_select vis_opt_partition_by vis_opt_draw_remap vis_opt_using {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_VIS_LAYER, {
            Attr(Key::VIS_LAYER_GEOM,          $2),
            Attr(Key::VIS_LAYER_SELECT,        $3),
            Attr(Key::VIS_LAYER_PARTITION_BY,  $4),
            Attr(Key::VIS_LAYER_REMAP,         $5),
            Attr(Key::VIS_LAYER_USING,         $6),
        }, false);
    }
    ;

vis_opt_draw_select:
    FROM LRB sql_select_stmt RRB {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_SELECT, std::move($3));
    }
  | %empty { $$ = Null(); }
    ;

// REMAP (<target>, ...). A bare target list (`count AS y, density AS fill`)
// that renames columns added by the layer's statistical transformation.
// Reuses sql_target_list so the same `<expr> AS <name>` syntax works.
vis_opt_draw_remap:
    REMAP LRB sql_target_list RRB  { $$ = ctx.Array(@$, std::move($3)); }
  | %empty                         { $$ = Null(); }
    ;

vis_opt_partition_by:
    PARTITION BY vis_identifier_list  { $$ = ctx.Array(@$, std::move($3)); }
  | %empty                            { $$ = Null(); }
    ;

// ---------------------------------------------------------------------------
// SCALE
//
//   SCALE [<type>][(<opt>, ...)] <aesthetic>
//     [FROM <bracket-array>] [TO <bracket-array>]
//     [FORMAT (lambda <param> : <expr>)]
//     [USING (...)]
//
// Scale type is an optional enum keyword that may carry a parenthesized
// option list. Each option is either a named kwarg `<name> => <value>` or a
// bare `lambda <p>: <expr>` (a type-bound lambda replacing the old TRANSFORM
// clause — e.g. `continuous(lambda v: log10(v), breaks => log10)`).
// Reserving LAMBDA lets it appear unambiguously as an unnamed option entry.
//
// Aesthetic is a plain IDENT so clause-starter keywords don't get absorbed.
// FROM/TO each carry a bracket-array literal (e.g. `[0, 100]` or `['a','b']`)
// reusing `vararg_array_brackets`. FORMAT takes a lambda that maps each
// break value to a rendered label.

vis_scale_clause:
    SCALE_P vis_opt_scale_type vis_opt_scale_options IDENT
        vis_opt_scale_from vis_opt_scale_to
        vis_opt_scale_format vis_opt_using {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_VIS_SCALE, {
            Attr(Key::VIS_SCALE_TYPE,       $2),
            Attr(Key::VIS_SCALE_OPTIONS,    $3),
            Attr(Key::VIS_SCALE_AESTHETIC,  NameFromIdentifier(@4, $4)),
            Attr(Key::VIS_SCALE_FROM,       $5),
            Attr(Key::VIS_SCALE_TO,         $6),
            Attr(Key::VIS_SCALE_FORMAT,     $7),
            Attr(Key::VIS_SCALE_USING,      $8),
        }, false);
    }
    ;

vis_opt_scale_type:
    CONTINUOUS  { $$ = Enum(@1, buffers::parser::VisScaleType::CONTINUOUS); }
  | DISCRETE    { $$ = Enum(@1, buffers::parser::VisScaleType::DISCRETE); }
  | BINNED      { $$ = Enum(@1, buffers::parser::VisScaleType::BINNED); }
  | ORDINAL     { $$ = Enum(@1, buffers::parser::VisScaleType::ORDINAL); }
  | IDENTITY_P  { $$ = Enum(@1, buffers::parser::VisScaleType::IDENTITY); }
  | %empty      { $$ = Null(); }
    ;

// Type-bound options: a parenthesized list whose entries are one of:
//   - `<name> => <value>`          (regular kwarg, vararg syntax)
//   - `<name> => lambda <p>: <e>`  (named lambda — `value => lambda v: log10(v)`)
//   - `lambda <p>: <e>`            (bare lambda, unnamed positional entry)
// The unnamed form is kept so common cases stay concise. LAMBDA is reserved
// so an entry starting with it cannot be mistaken for a kwarg key.
vis_opt_scale_options:
    LRB vis_scale_option_list RRB  { $$ = ctx.Array(@$, std::move($2)); }
  | %empty                         { $$ = Null(); }
    ;

vis_scale_option_list:
    vis_scale_option                                  { $$ = ctx.List({ $1 }); }
  | vis_scale_option_list COMMA vis_scale_option      { $1->push_back($3); $$ = std::move($1); }
    ;

vis_scale_option:
    vis_option                                  { $$ = $1; }
  | sql_col_id EQUALS_GREATER vis_lambda        { $$ = VarArgField(ctx, @$, ctx.List({ $1 }), $3); }
  | vis_lambda                                  { $$ = $1; }
    ;

vis_opt_scale_from:
    FROM vis_scale_bound   { $$ = $2; }
  | %empty                 { $$ = Null(); }
    ;

vis_opt_scale_to:
    TO vis_scale_bound     { $$ = $2; }
  | %empty                 { $$ = Null(); }
    ;

vis_scale_bound:
    vararg_array_brackets {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_EXT_VARARG_ARRAY, {
            Attr(Key::EXT_VARARG_ARRAY_VALUES, ctx.Array(@1, std::move($1))),
        });
    }
    ;

// FORMAT (lambda <param> : <expr>). The body is a full sql_a_expr so the
// user can write a CASE, function call, or arithmetic over the break value.
// Parens keep the body from absorbing the next clause's keyword.
vis_opt_scale_format:
    FORMAT LRB vis_lambda RRB  { $$ = $3; }
  | %empty                     { $$ = Null(); }
    ;

vis_lambda:
    LAMBDA sql_col_id COLON sql_a_expr {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_LAMBDA_EXPRESSION, {
            Attr(Key::SQL_LAMBDA_PARAM, $2),
            Attr(Key::SQL_LAMBDA_BODY,  ctx.Expression(std::move($4))),
        });
    }
    ;

// ---------------------------------------------------------------------------
// FACET
//
//   FACET <rows> [BY <cols>] [USING (...)]

vis_facet_clause:
    FACET vis_identifier_list vis_opt_facet_by vis_opt_using {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_VIS_FACET, {
            Attr(Key::VIS_FACET_ROWS,  ctx.Array(@2, std::move($2))),
            Attr(Key::VIS_FACET_COLS,  $3),
            Attr(Key::VIS_FACET_USING, $4),
        });
    }
    ;

vis_opt_facet_by:
    BY vis_identifier_list  { $$ = ctx.Array(@$, std::move($2)); }
  | %empty                  { $$ = Null(); }
    ;

// ---------------------------------------------------------------------------
// PROJECT
//
//   PROJECT [<aesthetics>] TO <type> [USING (...)]
//
// Project type is an IDENT resolved via ProjectTypeEnum.

vis_project_clause:
    PROJECT_P vis_opt_project_aesthetics TO IDENT vis_opt_using {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_VIS_PROJECT, {
            Attr(Key::VIS_PROJECT_AESTHETICS, $2),
            Attr(Key::VIS_PROJECT_TYPE,       vis::ProjectTypeEnum(ctx, @4)),
            Attr(Key::VIS_PROJECT_USING,      $5),
        });
    }
    ;

vis_opt_project_aesthetics:
    vis_identifier_list  { $$ = ctx.Array(@$, std::move($1)); }
  | %empty               { $$ = Null(); }
    ;

// ---------------------------------------------------------------------------
// LABEL
//
//   LABEL USING (title => 'Sales by Region')

vis_label_clause:
    LABEL USING LRB vis_option_list RRB {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_VIS_LABEL, {
            Attr(Key::VIS_LABEL_USING, ctx.Array(@4, std::move($4))),
        });
    }
    ;

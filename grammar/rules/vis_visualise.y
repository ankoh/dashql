// ---------------------------------------------------------------------------
// VISUALISE extension.
//
// Shape:
//
//   VISUALISE [(SELECT ...)]
//     DRAW <geom> [AS (SELECT ... [WHERE ...] [PARTITION BY ...] [ORDER BY ...])] [USING (...)]
//     PLACE <geom> [USING (...)]
//     SCALE [<type>] <aesthetic> [BETWEEN [...] AND [...]] [USING (...)]
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
  | vis_place_clause    { $$ = $1; }
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
//   DRAW <geom> [AS (SELECT <targets> [FROM ...] [WHERE ...] [PARTITION BY ...] [ORDER BY ...])] [USING (...)]
//
// Inside `AS (...)` we use a restricted SELECT that only permits targets,
// WHERE, and ORDER BY. The top-level FROM lives on VISUALISE and is inherited
// by every layer, so we grammatically forbid FROM here instead of accepting
// it and rejecting in actions.

vis_draw_clause:
    DRAW vis_geom vis_opt_draw_select vis_opt_using {
        $$ = vis::Layer(ctx, @$, buffers::parser::VisLayerKind::DRAW, $2, {
            Attr(Key::VIS_LAYER_SELECT,  $3),
            Attr(Key::VIS_LAYER_USING,   $4),
        });
    }
    ;

vis_opt_draw_select:
    AS LRB vis_layer_select RRB {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_SELECT, std::move($3));
    }
  | %empty { $$ = Null(); }
    ;

// Restricted SELECT for layer bodies: targets, optional WHERE, optional
// PARTITION BY, optional ORDER BY. PARTITION BY is a ggsql layer-level concept
// that gets emitted as a dedicated attribute on the select node rather than
// reusing SQL_SELECT_GROUPS (which would be semantically wrong).
// No FROM / GROUP BY / HAVING / WINDOW / set ops / LIMIT.
vis_layer_select:
    SELECT sql_target_list sql_where_clause vis_opt_partition_by sql_opt_sort_clause {
        $$ = ctx.List({
            Attr(Key::SQL_SELECT_TARGETS,     ctx.Array(@2, std::move($2))),
            Attr(Key::SQL_SELECT_WHERE,       $3),
            Attr(Key::VIS_LAYER_PARTITION_BY, $4),
            Attr(Key::SQL_SELECT_ORDER,       $5),
        });
    }
    ;

vis_opt_partition_by:
    PARTITION BY sql_expr_list  { $$ = ctx.Array(@$, std::move($3)); }
  | %empty                      { $$ = Null(); }
    ;

// ---------------------------------------------------------------------------
// PLACE

vis_place_clause:
    PLACE vis_geom vis_opt_using {
        $$ = vis::Layer(ctx, @$, buffers::parser::VisLayerKind::PLACE, $2, {
            Attr(Key::VIS_LAYER_USING, $3),
        });
    }
    ;

// ---------------------------------------------------------------------------
// SCALE
//
//   SCALE [<type>] <aesthetic> [BETWEEN [lower] AND [upper]] [USING (...)]
//
// Aesthetic is a plain IDENT so clause-starter keywords don't get absorbed.

vis_scale_clause:
    SCALE_P vis_opt_scale_type IDENT vis_opt_scale_between vis_opt_using {
        auto list = ctx.List({
            Attr(Key::VIS_SCALE_TYPE,      $2),
            Attr(Key::VIS_SCALE_AESTHETIC, NameFromIdentifier(@3, $3)),
        });
        list->append(std::move($4));
        list->append({ Attr(Key::VIS_SCALE_USING, $5) });
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_VIS_SCALE, std::move(list), false);
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

// BETWEEN [lower] AND [upper]. Bounds are bracket-array literals reusing
// vararg_array_brackets. Values are whatever `vararg_value` already accepts.
vis_opt_scale_between:
    BETWEEN vis_scale_bound AND vis_scale_bound {
        $$ = ctx.List({
            Attr(Key::VIS_SCALE_BETWEEN_LOWER, $2),
            Attr(Key::VIS_SCALE_BETWEEN_UPPER, $4),
        });
    }
  | %empty { $$ = ctx.List(); }
    ;

vis_scale_bound:
    vararg_array_brackets {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_EXT_VARARG_ARRAY, {
            Attr(Key::EXT_VARARG_ARRAY_VALUES, ctx.Array(@1, std::move($1))),
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

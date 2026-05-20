// ---------------------------------------------------------------------------
// VISUALISE extension: Vega-Lite specification mapping.
//
// Shape:
//
//   VISUALIZE <table-ref> AS (
//       mark => 'line',
//       encoding => (
//           x => (field => time, type => temporal, scale => (domain => [0, 100]))
//       ),
//       width => 800
//   )
//
// 4-level structured grammar for autocompletion:
//   Level 1: Top-level spec properties (mark, encoding, width, ...)
//   Level 2: Encoding channel names (x, y, color, ...)
//   Level 3: Field definition properties (field, type, scale, axis, ...)
//   Level 4: Scale/Axis/Legend properties (domain, range, scheme, ...)
//
// Each level has its own key rule so bison reports level-appropriate expected
// symbols for autocompletion. Structural keys (ENCODING, SCALE_P, AXIS, LEGEND)
// get dedicated productions that explicitly descend into the next level.
//
// Nested object values re-enter vis_spec_list (level 1) so autocompletion
// suggests top-level spec keys. The vis_encoding_value rule omits the
// nested-object production to avoid reduce/reduce with the structural
// channel path at level 2.

vis_visualise_keyword:
    VISUALISE  { $$ = $1; }
  | VISUALIZE  { $$ = $1; }
    ;

vis_visualise_stmt:
    vis_visualise_keyword vis_opt_source AS LRB vis_spec_list RRB {
        if (!ctx.IsVisEnabled()) {
            error(@1, "VISUALISE syntax is disabled in this ParseContext");
            YYERROR;
        }
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_VIS_VISUALISE, {
            Attr(Key::VIS_VISUALISE_SELECT, $2),
            Attr(Key::VIS_VISUALISE_SPEC, ctx.Array(@5, std::move($5))),
        }, false);
    }
    ;

vis_opt_source:
    LRB sql_select_stmt RRB {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_SELECT, std::move($2));
    }
  | sql_relation_expr {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_TABLEREF, std::move($1));
    }
  | %empty { $$ = Null(); }
    ;

// ---------------------------------------------------------------------------
// Level 1: Top-level spec fields

vis_spec_list:
    vis_spec_list COMMA opt_vis_spec_field  { $1->push_back($3); $$ = std::move($1); }
  | opt_vis_spec_field                      { $$ = ctx.List({$1}); }
    ;

opt_vis_spec_field:
    ENCODING EQUALS_GREATER LRB vis_encoding_list RRB {
        $$ = VarArgField(ctx, @$, ctx.List({ ctx.NameFromKeyword(@1, $1) }),
             ctx.Object(@$, buffers::parser::NodeType::OBJECT_EXT_VARARG_ARRAY, {
                 Attr(Key::EXT_VARARG_ARRAY_VALUES, ctx.Array(@4, std::move($4))),
             }));
    }
  | MARK EQUALS_GREATER vis_mark_value {
        $$ = VarArgField(ctx, @$, ctx.List({ ctx.NameFromKeyword(@1, $1) }), $3);
    }
  | vis_spec_key EQUALS_GREATER vis_value {
        $$ = VarArgField(ctx, @$, ctx.List({ $1 }), $3);
    }
  | %empty { $$ = Null(); }
    ;

vis_spec_key:
    IDENT           { $$ = NameFromIdentifier(@1, $1); }
  | LAYER           { $$ = ctx.NameFromKeyword(@1, $1); }
  | DATA_P          { $$ = ctx.NameFromKeyword(@1, $1); }
  | TRANSFORM       { $$ = ctx.NameFromKeyword(@1, $1); }
  | PARAMS          { $$ = ctx.NameFromKeyword(@1, $1); }
  | PROJECTION      { $$ = ctx.NameFromKeyword(@1, $1); }
  | AUTOSIZE        { $$ = ctx.NameFromKeyword(@1, $1); }
  | RESOLVE         { $$ = ctx.NameFromKeyword(@1, $1); }
  | DATASETS        { $$ = ctx.NameFromKeyword(@1, $1); }
  | VIEW            { $$ = ctx.NameFromKeyword(@1, $1); }
  | NAME_P          { $$ = ctx.NameFromKeyword(@1, $1); }
  | TITLE           { $$ = ctx.NameFromKeyword(@1, $1); }
  | WIDTH           { $$ = ctx.NameFromKeyword(@1, $1); }
  | HEIGHT          { $$ = ctx.NameFromKeyword(@1, $1); }
  | PADDING         { $$ = ctx.NameFromKeyword(@1, $1); }
  | BACKGROUND      { $$ = ctx.NameFromKeyword(@1, $1); }
  | FILTER          { $$ = ctx.NameFromKeyword(@1, $1); }
  | DESCRIBE        { $$ = ctx.NameFromKeyword(@1, $1); }
  | TYPE_P          { $$ = ctx.NameFromKeyword(@1, $1); }
    ;

vis_mark_value:
    vis_mark_type {
        $$ = $1;
    }
  | LRB vis_spec_list RRB {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_EXT_VARARG_ARRAY, {
            Attr(Key::EXT_VARARG_ARRAY_VALUES, ctx.Array(@2, std::move($2))),
        });
    }
  | sql_a_expr_const { $$ = ctx.Expression(std::move($1)); }
    ;

vis_mark_type:
    ARC             { $$ = ctx.NameFromKeyword(@1, $1); }
  | AREA            { $$ = ctx.NameFromKeyword(@1, $1); }
  | BAR             { $$ = ctx.NameFromKeyword(@1, $1); }
  | BOXPLOT         { $$ = ctx.NameFromKeyword(@1, $1); }
  | CIRCLE          { $$ = ctx.NameFromKeyword(@1, $1); }
  | GEOSHAPE        { $$ = ctx.NameFromKeyword(@1, $1); }
  | IMAGE           { $$ = ctx.NameFromKeyword(@1, $1); }
  | LINE            { $$ = ctx.NameFromKeyword(@1, $1); }
  | POINT           { $$ = ctx.NameFromKeyword(@1, $1); }
  | RECT            { $$ = ctx.NameFromKeyword(@1, $1); }
  | RULE            { $$ = ctx.NameFromKeyword(@1, $1); }
  | SQUARE          { $$ = ctx.NameFromKeyword(@1, $1); }
  | TEXT_P          { $$ = ctx.NameFromKeyword(@1, $1); }
  | TICK            { $$ = ctx.NameFromKeyword(@1, $1); }
  | TRAIL           { $$ = ctx.NameFromKeyword(@1, $1); }
    ;

// ---------------------------------------------------------------------------
// Level 2: Encoding channels

vis_encoding_list:
    vis_encoding_list COMMA opt_vis_encoding_field  { $1->push_back($3); $$ = std::move($1); }
  | opt_vis_encoding_field                          { $$ = ctx.List({$1}); }
    ;

opt_vis_encoding_field:
    vis_channel_key EQUALS_GREATER LRB vis_fielddef_list RRB {
        $$ = VarArgField(ctx, @$, ctx.List({ $1 }),
             ctx.Object(@$, buffers::parser::NodeType::OBJECT_EXT_VARARG_ARRAY, {
                 Attr(Key::EXT_VARARG_ARRAY_VALUES, ctx.Array(@4, std::move($4))),
             }));
    }
  | vis_channel_key EQUALS_GREATER vis_encoding_value {
        $$ = VarArgField(ctx, @$, ctx.List({ $1 }), $3);
    }
  | %empty { $$ = Null(); }
    ;

vis_channel_key:
    IDENT             { $$ = NameFromIdentifier(@1, $1); }
  | COLOR             { $$ = ctx.NameFromKeyword(@1, $1); }
  | FILL              { $$ = ctx.NameFromKeyword(@1, $1); }
  | STROKE            { $$ = ctx.NameFromKeyword(@1, $1); }
  | FILLOPACITY       { $$ = ctx.NameFromKeyword(@1, $1); }
  | STROKEOPACITY     { $$ = ctx.NameFromKeyword(@1, $1); }
  | STROKEWIDTH       { $$ = ctx.NameFromKeyword(@1, $1); }
  | STROKEDASH        { $$ = ctx.NameFromKeyword(@1, $1); }
  | OPACITY           { $$ = ctx.NameFromKeyword(@1, $1); }
  | SIZE              { $$ = ctx.NameFromKeyword(@1, $1); }
  | SHAPE             { $$ = ctx.NameFromKeyword(@1, $1); }
  | ANGLE             { $$ = ctx.NameFromKeyword(@1, $1); }
  | THETA             { $$ = ctx.NameFromKeyword(@1, $1); }
  | THETA2            { $$ = ctx.NameFromKeyword(@1, $1); }
  | RADIUS            { $$ = ctx.NameFromKeyword(@1, $1); }
  | RADIUS2           { $$ = ctx.NameFromKeyword(@1, $1); }
  | DETAIL            { $$ = ctx.NameFromKeyword(@1, $1); }
  | ORDER             { $$ = ctx.NameFromKeyword(@1, $1); }
  | TOOLTIP           { $$ = ctx.NameFromKeyword(@1, $1); }
  | TEXT_P            { $$ = ctx.NameFromKeyword(@1, $1); }
  | ROW               { $$ = ctx.NameFromKeyword(@1, $1); }
  | COLUMN            { $$ = ctx.NameFromKeyword(@1, $1); }
  | FACET             { $$ = ctx.NameFromKeyword(@1, $1); }
  | HREF              { $$ = ctx.NameFromKeyword(@1, $1); }
  | URL_P             { $$ = ctx.NameFromKeyword(@1, $1); }
  | KEY               { $$ = ctx.NameFromKeyword(@1, $1); }
  | LATITUDE          { $$ = ctx.NameFromKeyword(@1, $1); }
  | LONGITUDE         { $$ = ctx.NameFromKeyword(@1, $1); }
  | LATITUDE2         { $$ = ctx.NameFromKeyword(@1, $1); }
  | LONGITUDE2        { $$ = ctx.NameFromKeyword(@1, $1); }
  | XOFFSET           { $$ = ctx.NameFromKeyword(@1, $1); }
  | YOFFSET           { $$ = ctx.NameFromKeyword(@1, $1); }
    ;

vis_encoding_value:
    vararg_array_brackets {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_EXT_VARARG_ARRAY, {
            Attr(Key::EXT_VARARG_ARRAY_VALUES, ctx.Array(@1, std::move($1))),
        });
    }
  | sql_func_expr             { $$ = $1; }
  | sql_columnref             { $$ = $1; }
  | sql_a_expr_const          { $$ = ctx.Expression(std::move($1)); }
  | PLUS sql_a_expr_const %prec UMINUS   { $$ = ctx.Expression(std::move($2)); }
  | MINUS sql_a_expr_const %prec UMINUS  { $$ = Negate(ctx, @$, @1, ctx.Expression(std::move($2))); }
    ;

// ---------------------------------------------------------------------------
// Level 3: Field definition properties

vis_fielddef_list:
    vis_fielddef_list COMMA opt_vis_fielddef_field  { $1->push_back($3); $$ = std::move($1); }
  | opt_vis_fielddef_field                          { $$ = ctx.List({$1}); }
    ;

opt_vis_fielddef_field:
    SCALE_P EQUALS_GREATER LRB vis_scale_list RRB {
        $$ = VarArgField(ctx, @$, ctx.List({ ctx.NameFromKeyword(@1, $1) }),
             ctx.Object(@$, buffers::parser::NodeType::OBJECT_EXT_VARARG_ARRAY, {
                 Attr(Key::EXT_VARARG_ARRAY_VALUES, ctx.Array(@4, std::move($4))),
             }));
    }
  | AXIS EQUALS_GREATER LRB vis_axis_list RRB {
        $$ = VarArgField(ctx, @$, ctx.List({ ctx.NameFromKeyword(@1, $1) }),
             ctx.Object(@$, buffers::parser::NodeType::OBJECT_EXT_VARARG_ARRAY, {
                 Attr(Key::EXT_VARARG_ARRAY_VALUES, ctx.Array(@4, std::move($4))),
             }));
    }
  | LEGEND EQUALS_GREATER LRB vis_legend_list RRB {
        $$ = VarArgField(ctx, @$, ctx.List({ ctx.NameFromKeyword(@1, $1) }),
             ctx.Object(@$, buffers::parser::NodeType::OBJECT_EXT_VARARG_ARRAY, {
                 Attr(Key::EXT_VARARG_ARRAY_VALUES, ctx.Array(@4, std::move($4))),
             }));
    }
  | vis_fielddef_key EQUALS_GREATER vis_value {
        $$ = VarArgField(ctx, @$, ctx.List({ $1 }), $3);
    }
  | %empty { $$ = Null(); }
    ;

vis_fielddef_key:
    IDENT           { $$ = NameFromIdentifier(@1, $1); }
  | FIELD           { $$ = ctx.NameFromKeyword(@1, $1); }
  | TYPE_P          { $$ = ctx.NameFromKeyword(@1, $1); }
  | BIN             { $$ = ctx.NameFromKeyword(@1, $1); }
  | AGGREGATE       { $$ = ctx.NameFromKeyword(@1, $1); }
  | TIMEUNIT        { $$ = ctx.NameFromKeyword(@1, $1); }
  | SORT            { $$ = ctx.NameFromKeyword(@1, $1); }
  | STACK           { $$ = ctx.NameFromKeyword(@1, $1); }
  | IMPUTE          { $$ = ctx.NameFromKeyword(@1, $1); }
  | CONDITION       { $$ = ctx.NameFromKeyword(@1, $1); }
  | TITLE           { $$ = ctx.NameFromKeyword(@1, $1); }
  | BANDPOSITION    { $$ = ctx.NameFromKeyword(@1, $1); }
  | DATUM           { $$ = ctx.NameFromKeyword(@1, $1); }
  | VALUE_P         { $$ = ctx.NameFromKeyword(@1, $1); }
  | FORMAT          { $$ = ctx.NameFromKeyword(@1, $1); }
  | FORMATTYPE      { $$ = ctx.NameFromKeyword(@1, $1); }
    ;

// ---------------------------------------------------------------------------
// Level 4: Scale properties

vis_scale_list:
    vis_scale_list COMMA opt_vis_scale_field  { $1->push_back($3); $$ = std::move($1); }
  | opt_vis_scale_field                       { $$ = ctx.List({$1}); }
    ;

opt_vis_scale_field:
    vis_scale_key EQUALS_GREATER vis_value {
        $$ = VarArgField(ctx, @$, ctx.List({ $1 }), $3);
    }
  | %empty { $$ = Null(); }
    ;

vis_scale_key:
    IDENT           { $$ = NameFromIdentifier(@1, $1); }
  | TYPE_P          { $$ = ctx.NameFromKeyword(@1, $1); }
  | DOMAIN_P        { $$ = ctx.NameFromKeyword(@1, $1); }
  | DOMAINMIN       { $$ = ctx.NameFromKeyword(@1, $1); }
  | DOMAINMAX       { $$ = ctx.NameFromKeyword(@1, $1); }
  | DOMAINMID       { $$ = ctx.NameFromKeyword(@1, $1); }
  | RANGE           { $$ = ctx.NameFromKeyword(@1, $1); }
  | RANGEMIN        { $$ = ctx.NameFromKeyword(@1, $1); }
  | RANGEMAX        { $$ = ctx.NameFromKeyword(@1, $1); }
  | SCHEME          { $$ = ctx.NameFromKeyword(@1, $1); }
  | INTERPOLATE     { $$ = ctx.NameFromKeyword(@1, $1); }
  | NICE            { $$ = ctx.NameFromKeyword(@1, $1); }
  | ZERO            { $$ = ctx.NameFromKeyword(@1, $1); }
  | CLAMP           { $$ = ctx.NameFromKeyword(@1, $1); }
  | PADDING         { $$ = ctx.NameFromKeyword(@1, $1); }
  | PADDINGINNER    { $$ = ctx.NameFromKeyword(@1, $1); }
  | PADDINGOUTER    { $$ = ctx.NameFromKeyword(@1, $1); }
  | REVERSE         { $$ = ctx.NameFromKeyword(@1, $1); }
  | ROUND           { $$ = ctx.NameFromKeyword(@1, $1); }
  | EXPONENT        { $$ = ctx.NameFromKeyword(@1, $1); }
  | BINS            { $$ = ctx.NameFromKeyword(@1, $1); }
  | NAME_P          { $$ = ctx.NameFromKeyword(@1, $1); }
    ;

// ---------------------------------------------------------------------------
// Level 4: Axis properties

vis_axis_list:
    vis_axis_list COMMA opt_vis_axis_field  { $1->push_back($3); $$ = std::move($1); }
  | opt_vis_axis_field                      { $$ = ctx.List({$1}); }
    ;

opt_vis_axis_field:
    vis_axis_key EQUALS_GREATER vis_value {
        $$ = VarArgField(ctx, @$, ctx.List({ $1 }), $3);
    }
  | %empty { $$ = Null(); }
    ;

vis_axis_key:
    IDENT           { $$ = NameFromIdentifier(@1, $1); }
  | ORIENT          { $$ = ctx.NameFromKeyword(@1, $1); }
  | FORMAT          { $$ = ctx.NameFromKeyword(@1, $1); }
  | FORMATTYPE      { $$ = ctx.NameFromKeyword(@1, $1); }
  | GRID            { $$ = ctx.NameFromKeyword(@1, $1); }
  | TICKS           { $$ = ctx.NameFromKeyword(@1, $1); }
  | TICKCOUNT       { $$ = ctx.NameFromKeyword(@1, $1); }
  | TICKSIZE        { $$ = ctx.NameFromKeyword(@1, $1); }
  | LABELANGLE      { $$ = ctx.NameFromKeyword(@1, $1); }
  | LABELFONTSIZE   { $$ = ctx.NameFromKeyword(@1, $1); }
  | LABELOVERLAP    { $$ = ctx.NameFromKeyword(@1, $1); }
  | DIRECTION       { $$ = ctx.NameFromKeyword(@1, $1); }
  | OFFSET          { $$ = ctx.NameFromKeyword(@1, $1); }
  | VALUES          { $$ = ctx.NameFromKeyword(@1, $1); }
  | ZINDEX          { $$ = ctx.NameFromKeyword(@1, $1); }
  | TITLE           { $$ = ctx.NameFromKeyword(@1, $1); }
  | DOMAIN_P        { $$ = ctx.NameFromKeyword(@1, $1); }
  | NAME_P          { $$ = ctx.NameFromKeyword(@1, $1); }
    ;

// ---------------------------------------------------------------------------
// Level 4: Legend properties

vis_legend_list:
    vis_legend_list COMMA opt_vis_legend_field  { $1->push_back($3); $$ = std::move($1); }
  | opt_vis_legend_field                        { $$ = ctx.List({$1}); }
    ;

opt_vis_legend_field:
    vis_legend_key EQUALS_GREATER vis_value {
        $$ = VarArgField(ctx, @$, ctx.List({ $1 }), $3);
    }
  | %empty { $$ = Null(); }
    ;

vis_legend_key:
    IDENT           { $$ = NameFromIdentifier(@1, $1); }
  | TYPE_P          { $$ = ctx.NameFromKeyword(@1, $1); }
  | ORIENT          { $$ = ctx.NameFromKeyword(@1, $1); }
  | FORMAT          { $$ = ctx.NameFromKeyword(@1, $1); }
  | FORMATTYPE      { $$ = ctx.NameFromKeyword(@1, $1); }
  | DIRECTION       { $$ = ctx.NameFromKeyword(@1, $1); }
  | TITLE           { $$ = ctx.NameFromKeyword(@1, $1); }
  | VALUES          { $$ = ctx.NameFromKeyword(@1, $1); }
  | PADDING         { $$ = ctx.NameFromKeyword(@1, $1); }
  | OFFSET          { $$ = ctx.NameFromKeyword(@1, $1); }
  | ZINDEX          { $$ = ctx.NameFromKeyword(@1, $1); }
  | NAME_P          { $$ = ctx.NameFromKeyword(@1, $1); }
    ;

// ---------------------------------------------------------------------------
// Generic value rule (used at levels 1, 3, and inside scale/axis/legend)
//
// Nested objects re-enter vis_spec_list so autocompletion suggests top-level
// spec keys. The vis_encoding_value variant omits the nested-object production
// to avoid reduce/reduce with the structural channel path at level 2.

vis_value:
    LRB vis_spec_list RRB {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_EXT_VARARG_ARRAY, {
            Attr(Key::EXT_VARARG_ARRAY_VALUES, ctx.Array(@2, std::move($2))),
        });
    }
  | vararg_array_brackets {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_EXT_VARARG_ARRAY, {
            Attr(Key::EXT_VARARG_ARRAY_VALUES, ctx.Array(@1, std::move($1))),
        });
    }
  | sql_func_expr             { $$ = $1; }
  | sql_columnref             { $$ = $1; }
  | sql_a_expr_const          { $$ = ctx.Expression(std::move($1)); }
  | PLUS sql_a_expr_const %prec UMINUS   { $$ = ctx.Expression(std::move($2)); }
  | MINUS sql_a_expr_const %prec UMINUS  { $$ = Negate(ctx, @$, @1, ctx.Expression(std::move($2))); }
    ;

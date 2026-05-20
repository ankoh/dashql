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
        $$ = VarArgField(ctx, @$, ctx.List({ Enum(@1, buffers::parser::VisSpecKey::ENCODING) }),
             ctx.Object(@$, buffers::parser::NodeType::OBJECT_EXT_VARARG_ARRAY, {
                 Attr(Key::EXT_VARARG_ARRAY_VALUES, ctx.Array(@4, std::move($4))),
             }));
    }
  | MARK EQUALS_GREATER vis_mark_value {
        $$ = VarArgField(ctx, @$, ctx.List({ Enum(@1, buffers::parser::VisSpecKey::MARK) }), $3);
    }
  | vis_spec_key EQUALS_GREATER vis_value {
        $$ = VarArgField(ctx, @$, ctx.List({ $1 }), $3);
    }
  | %empty { $$ = Null(); }
    ;

vis_spec_key:
    IDENT           { $$ = NameFromIdentifier(@1, $1); }
  | LAYER           { $$ = Enum(@1, buffers::parser::VisSpecKey::LAYER); }
  | DATA_P          { $$ = Enum(@1, buffers::parser::VisSpecKey::DATA); }
  | TRANSFORM       { $$ = Enum(@1, buffers::parser::VisSpecKey::TRANSFORM); }
  | PARAMS          { $$ = Enum(@1, buffers::parser::VisSpecKey::PARAMS); }
  | PROJECTION      { $$ = Enum(@1, buffers::parser::VisSpecKey::PROJECTION); }
  | AUTOSIZE        { $$ = Enum(@1, buffers::parser::VisSpecKey::AUTOSIZE); }
  | RESOLVE         { $$ = Enum(@1, buffers::parser::VisSpecKey::RESOLVE); }
  | DATASETS        { $$ = Enum(@1, buffers::parser::VisSpecKey::DATASETS); }
  | VIEW            { $$ = Enum(@1, buffers::parser::VisSpecKey::VIEW); }
  | NAME_P          { $$ = Enum(@1, buffers::parser::VisSpecKey::NAME); }
  | TITLE           { $$ = Enum(@1, buffers::parser::VisSpecKey::TITLE); }
  | WIDTH           { $$ = Enum(@1, buffers::parser::VisSpecKey::WIDTH); }
  | HEIGHT          { $$ = Enum(@1, buffers::parser::VisSpecKey::HEIGHT); }
  | PADDING         { $$ = Enum(@1, buffers::parser::VisSpecKey::PADDING); }
  | BACKGROUND      { $$ = Enum(@1, buffers::parser::VisSpecKey::BACKGROUND); }
  | FILTER          { $$ = Enum(@1, buffers::parser::VisSpecKey::FILTER); }
  | DESCRIBE        { $$ = Enum(@1, buffers::parser::VisSpecKey::DESCRIPTION); }
  | TYPE_P          { $$ = Enum(@1, buffers::parser::VisSpecKey::TYPE); }
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
    ARC             { $$ = Enum(@1, buffers::parser::VisMarkType::ARC); }
  | AREA            { $$ = Enum(@1, buffers::parser::VisMarkType::AREA); }
  | BAR             { $$ = Enum(@1, buffers::parser::VisMarkType::BAR); }
  | BOXPLOT         { $$ = Enum(@1, buffers::parser::VisMarkType::BOXPLOT); }
  | CIRCLE          { $$ = Enum(@1, buffers::parser::VisMarkType::CIRCLE); }
  | GEOSHAPE        { $$ = Enum(@1, buffers::parser::VisMarkType::GEOSHAPE); }
  | IMAGE           { $$ = Enum(@1, buffers::parser::VisMarkType::IMAGE); }
  | LINE            { $$ = Enum(@1, buffers::parser::VisMarkType::LINE); }
  | POINT           { $$ = Enum(@1, buffers::parser::VisMarkType::POINT); }
  | RECT            { $$ = Enum(@1, buffers::parser::VisMarkType::RECT); }
  | RULE            { $$ = Enum(@1, buffers::parser::VisMarkType::RULE); }
  | SQUARE          { $$ = Enum(@1, buffers::parser::VisMarkType::SQUARE); }
  | TEXT_P          { $$ = Enum(@1, buffers::parser::VisMarkType::TEXT); }
  | TICK            { $$ = Enum(@1, buffers::parser::VisMarkType::TICK); }
  | TRAIL           { $$ = Enum(@1, buffers::parser::VisMarkType::TRAIL); }
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
  | COLOR             { $$ = Enum(@1, buffers::parser::VisEncodingChannel::COLOR); }
  | FILL              { $$ = Enum(@1, buffers::parser::VisEncodingChannel::FILL); }
  | STROKE            { $$ = Enum(@1, buffers::parser::VisEncodingChannel::STROKE); }
  | FILLOPACITY       { $$ = Enum(@1, buffers::parser::VisEncodingChannel::FILL_OPACITY); }
  | STROKEOPACITY     { $$ = Enum(@1, buffers::parser::VisEncodingChannel::STROKE_OPACITY); }
  | STROKEWIDTH       { $$ = Enum(@1, buffers::parser::VisEncodingChannel::STROKE_WIDTH); }
  | STROKEDASH        { $$ = Enum(@1, buffers::parser::VisEncodingChannel::STROKE_DASH); }
  | OPACITY           { $$ = Enum(@1, buffers::parser::VisEncodingChannel::OPACITY); }
  | SIZE              { $$ = Enum(@1, buffers::parser::VisEncodingChannel::SIZE); }
  | SHAPE             { $$ = Enum(@1, buffers::parser::VisEncodingChannel::SHAPE); }
  | ANGLE             { $$ = Enum(@1, buffers::parser::VisEncodingChannel::ANGLE); }
  | THETA             { $$ = Enum(@1, buffers::parser::VisEncodingChannel::THETA); }
  | THETA2            { $$ = Enum(@1, buffers::parser::VisEncodingChannel::THETA2); }
  | RADIUS            { $$ = Enum(@1, buffers::parser::VisEncodingChannel::RADIUS); }
  | RADIUS2           { $$ = Enum(@1, buffers::parser::VisEncodingChannel::RADIUS2); }
  | DETAIL            { $$ = Enum(@1, buffers::parser::VisEncodingChannel::DETAIL); }
  | ORDER             { $$ = Enum(@1, buffers::parser::VisEncodingChannel::ORDER); }
  | TOOLTIP           { $$ = Enum(@1, buffers::parser::VisEncodingChannel::TOOLTIP); }
  | TEXT_P            { $$ = Enum(@1, buffers::parser::VisEncodingChannel::TEXT); }
  | ROW               { $$ = Enum(@1, buffers::parser::VisEncodingChannel::ROW); }
  | COLUMN            { $$ = Enum(@1, buffers::parser::VisEncodingChannel::COLUMN); }
  | FACET             { $$ = Enum(@1, buffers::parser::VisEncodingChannel::FACET); }
  | HREF              { $$ = Enum(@1, buffers::parser::VisEncodingChannel::HREF); }
  | URL_P             { $$ = Enum(@1, buffers::parser::VisEncodingChannel::URL); }
  | KEY               { $$ = Enum(@1, buffers::parser::VisEncodingChannel::KEY); }
  | LATITUDE          { $$ = Enum(@1, buffers::parser::VisEncodingChannel::LATITUDE); }
  | LONGITUDE         { $$ = Enum(@1, buffers::parser::VisEncodingChannel::LONGITUDE); }
  | LATITUDE2         { $$ = Enum(@1, buffers::parser::VisEncodingChannel::LATITUDE2); }
  | LONGITUDE2        { $$ = Enum(@1, buffers::parser::VisEncodingChannel::LONGITUDE2); }
  | XOFFSET           { $$ = Enum(@1, buffers::parser::VisEncodingChannel::X_OFFSET); }
  | YOFFSET           { $$ = Enum(@1, buffers::parser::VisEncodingChannel::Y_OFFSET); }
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
        $$ = VarArgField(ctx, @$, ctx.List({ Enum(@1, buffers::parser::VisFieldDefKey::SCALE) }),
             ctx.Object(@$, buffers::parser::NodeType::OBJECT_EXT_VARARG_ARRAY, {
                 Attr(Key::EXT_VARARG_ARRAY_VALUES, ctx.Array(@4, std::move($4))),
             }));
    }
  | AXIS EQUALS_GREATER LRB vis_axis_list RRB {
        $$ = VarArgField(ctx, @$, ctx.List({ Enum(@1, buffers::parser::VisFieldDefKey::AXIS) }),
             ctx.Object(@$, buffers::parser::NodeType::OBJECT_EXT_VARARG_ARRAY, {
                 Attr(Key::EXT_VARARG_ARRAY_VALUES, ctx.Array(@4, std::move($4))),
             }));
    }
  | LEGEND EQUALS_GREATER LRB vis_legend_list RRB {
        $$ = VarArgField(ctx, @$, ctx.List({ Enum(@1, buffers::parser::VisFieldDefKey::LEGEND) }),
             ctx.Object(@$, buffers::parser::NodeType::OBJECT_EXT_VARARG_ARRAY, {
                 Attr(Key::EXT_VARARG_ARRAY_VALUES, ctx.Array(@4, std::move($4))),
             }));
    }
  | TYPE_P EQUALS_GREATER vis_field_type {
        $$ = VarArgField(ctx, @$, ctx.List({ Enum(@1, buffers::parser::VisFieldDefKey::TYPE) }), $3);
    }
  | vis_fielddef_key EQUALS_GREATER vis_value {
        $$ = VarArgField(ctx, @$, ctx.List({ $1 }), $3);
    }
  | %empty { $$ = Null(); }
    ;

vis_fielddef_key:
    IDENT           { $$ = NameFromIdentifier(@1, $1); }
  | FIELD           { $$ = Enum(@1, buffers::parser::VisFieldDefKey::FIELD); }
  | BIN             { $$ = Enum(@1, buffers::parser::VisFieldDefKey::BIN); }
  | AGGREGATE       { $$ = Enum(@1, buffers::parser::VisFieldDefKey::AGGREGATE); }
  | TIMEUNIT        { $$ = Enum(@1, buffers::parser::VisFieldDefKey::TIME_UNIT); }
  | SORT            { $$ = Enum(@1, buffers::parser::VisFieldDefKey::SORT); }
  | STACK           { $$ = Enum(@1, buffers::parser::VisFieldDefKey::STACK); }
  | IMPUTE          { $$ = Enum(@1, buffers::parser::VisFieldDefKey::IMPUTE); }
  | CONDITION       { $$ = Enum(@1, buffers::parser::VisFieldDefKey::CONDITION); }
  | TITLE           { $$ = Enum(@1, buffers::parser::VisFieldDefKey::TITLE); }
  | BANDPOSITION    { $$ = Enum(@1, buffers::parser::VisFieldDefKey::BAND_POSITION); }
  | DATUM           { $$ = Enum(@1, buffers::parser::VisFieldDefKey::DATUM); }
  | VALUE_P         { $$ = Enum(@1, buffers::parser::VisFieldDefKey::VALUE); }
  | FORMAT          { $$ = Enum(@1, buffers::parser::VisFieldDefKey::FORMAT); }
  | FORMATTYPE      { $$ = Enum(@1, buffers::parser::VisFieldDefKey::FORMAT_TYPE); }
    ;

vis_field_type:
    NOMINAL         { $$ = Enum(@1, buffers::parser::VisFieldType::NOMINAL); }
  | ORDINAL         { $$ = Enum(@1, buffers::parser::VisFieldType::ORDINAL); }
  | QUANTITATIVE    { $$ = Enum(@1, buffers::parser::VisFieldType::QUANTITATIVE); }
  | TEMPORAL        { $$ = Enum(@1, buffers::parser::VisFieldType::TEMPORAL); }
  | GEOJSON         { $$ = Enum(@1, buffers::parser::VisFieldType::GEOJSON); }
  | sql_a_expr_const { $$ = ctx.Expression(std::move($1)); }
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
  | TYPE_P          { $$ = Enum(@1, buffers::parser::VisScaleKey::TYPE); }
  | DOMAIN_P        { $$ = Enum(@1, buffers::parser::VisScaleKey::DOMAIN_); }
  | DOMAINMIN       { $$ = Enum(@1, buffers::parser::VisScaleKey::DOMAIN_MIN); }
  | DOMAINMAX       { $$ = Enum(@1, buffers::parser::VisScaleKey::DOMAIN_MAX); }
  | DOMAINMID       { $$ = Enum(@1, buffers::parser::VisScaleKey::DOMAIN_MID); }
  | RANGE           { $$ = Enum(@1, buffers::parser::VisScaleKey::RANGE); }
  | RANGEMIN        { $$ = Enum(@1, buffers::parser::VisScaleKey::RANGE_MIN); }
  | RANGEMAX        { $$ = Enum(@1, buffers::parser::VisScaleKey::RANGE_MAX); }
  | SCHEME          { $$ = Enum(@1, buffers::parser::VisScaleKey::SCHEME); }
  | INTERPOLATE     { $$ = Enum(@1, buffers::parser::VisScaleKey::INTERPOLATE); }
  | NICE            { $$ = Enum(@1, buffers::parser::VisScaleKey::NICE); }
  | ZERO            { $$ = Enum(@1, buffers::parser::VisScaleKey::ZERO); }
  | CLAMP           { $$ = Enum(@1, buffers::parser::VisScaleKey::CLAMP); }
  | PADDING         { $$ = Enum(@1, buffers::parser::VisScaleKey::PADDING); }
  | PADDINGINNER    { $$ = Enum(@1, buffers::parser::VisScaleKey::PADDING_INNER); }
  | PADDINGOUTER    { $$ = Enum(@1, buffers::parser::VisScaleKey::PADDING_OUTER); }
  | REVERSE         { $$ = Enum(@1, buffers::parser::VisScaleKey::REVERSE); }
  | ROUND           { $$ = Enum(@1, buffers::parser::VisScaleKey::ROUND); }
  | EXPONENT        { $$ = Enum(@1, buffers::parser::VisScaleKey::EXPONENT); }
  | BINS            { $$ = Enum(@1, buffers::parser::VisScaleKey::BINS); }
  | NAME_P          { $$ = Enum(@1, buffers::parser::VisScaleKey::NAME); }
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
  | ORIENT          { $$ = Enum(@1, buffers::parser::VisAxisKey::ORIENT); }
  | FORMAT          { $$ = Enum(@1, buffers::parser::VisAxisKey::FORMAT); }
  | FORMATTYPE      { $$ = Enum(@1, buffers::parser::VisAxisKey::FORMAT_TYPE); }
  | GRID            { $$ = Enum(@1, buffers::parser::VisAxisKey::GRID); }
  | TICKS           { $$ = Enum(@1, buffers::parser::VisAxisKey::TICKS); }
  | TICKCOUNT       { $$ = Enum(@1, buffers::parser::VisAxisKey::TICK_COUNT); }
  | TICKSIZE        { $$ = Enum(@1, buffers::parser::VisAxisKey::TICK_SIZE); }
  | LABELANGLE      { $$ = Enum(@1, buffers::parser::VisAxisKey::LABEL_ANGLE); }
  | LABELFONTSIZE   { $$ = Enum(@1, buffers::parser::VisAxisKey::LABEL_FONT_SIZE); }
  | LABELOVERLAP    { $$ = Enum(@1, buffers::parser::VisAxisKey::LABEL_OVERLAP); }
  | DIRECTION       { $$ = Enum(@1, buffers::parser::VisAxisKey::DIRECTION); }
  | OFFSET          { $$ = Enum(@1, buffers::parser::VisAxisKey::OFFSET); }
  | VALUES          { $$ = Enum(@1, buffers::parser::VisAxisKey::VALUES); }
  | ZINDEX          { $$ = Enum(@1, buffers::parser::VisAxisKey::ZINDEX); }
  | TITLE           { $$ = Enum(@1, buffers::parser::VisAxisKey::TITLE); }
  | DOMAIN_P        { $$ = Enum(@1, buffers::parser::VisAxisKey::DOMAIN_); }
  | NAME_P          { $$ = Enum(@1, buffers::parser::VisAxisKey::NAME); }
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
  | TYPE_P          { $$ = Enum(@1, buffers::parser::VisLegendKey::TYPE); }
  | ORIENT          { $$ = Enum(@1, buffers::parser::VisLegendKey::ORIENT); }
  | FORMAT          { $$ = Enum(@1, buffers::parser::VisLegendKey::FORMAT); }
  | FORMATTYPE      { $$ = Enum(@1, buffers::parser::VisLegendKey::FORMAT_TYPE); }
  | DIRECTION       { $$ = Enum(@1, buffers::parser::VisLegendKey::DIRECTION); }
  | TITLE           { $$ = Enum(@1, buffers::parser::VisLegendKey::TITLE); }
  | VALUES          { $$ = Enum(@1, buffers::parser::VisLegendKey::VALUES); }
  | PADDING         { $$ = Enum(@1, buffers::parser::VisLegendKey::PADDING); }
  | OFFSET          { $$ = Enum(@1, buffers::parser::VisLegendKey::OFFSET); }
  | ZINDEX          { $$ = Enum(@1, buffers::parser::VisLegendKey::ZINDEX); }
  | NAME_P          { $$ = Enum(@1, buffers::parser::VisLegendKey::NAME); }
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

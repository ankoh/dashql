// ---------------------------------------------------------------------------
// VISUALISE extension: Vega-Lite specification mapping.
//
// Shape:
//
//   VISUALIZE <table-ref> USING vegalite (
//       mark => line,
//       encoding => (
//           x => (field => time, type => temporal, scale => (domain => [0, 100]))
//       ),
//       width => 800
//   )
//
// 4-level structured grammar with dedicated object types and attribute keys:
//   Level 1: OBJECT_VIS_SPEC — top-level spec properties
//   Level 2: OBJECT_VIS_ENCODING — encoding channel definitions
//   Level 3: OBJECT_VIS_FIELD_DEF — field definition properties
//   Level 4: OBJECT_VIS_SCALE / OBJECT_VIS_AXIS / OBJECT_VIS_LEGEND
//
// Each level has its own key rule so bison reports level-appropriate expected
// symbols for autocompletion.

vis_visualise_keyword:
    VISUALISE  { $$ = $1; }
  | VISUALIZE  { $$ = $1; }
    ;

// The visualization renderer named after `USING` is a closed keyword set. Rather than
// reduce it to a shared `vis_renderer` nonterminal (which would erase the lookahead the
// parser needs to pick the renderer-specific spec body), each renderer keyword is inlined
// as a terminal so `USING vegalite (...)` and `USING umap (...)` branch to their
// own spec grammar. Adding a future renderer is a new alternative here plus its spec rules.
vis_visualise_stmt:
    vis_visualise_keyword vis_opt_source USING VEGALITE LRB vis_spec_list RRB {
        if (!ctx.IsVisEnabled()) {
            error(@1, "VISUALISE syntax is disabled in this ParseContext");
            YYERROR;
        }
        ctx.MarkVisSpecSpan(@6);
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_VIS_VISUALISE, {
            Attr(Key::VIS_VISUALISE_SELECT, $2),
            Attr(Key::VIS_VISUALISE_USING, ctx.NameFromKeyword(@4, $4)),
            Attr(Key::VIS_VISUALISE_SPEC,
                 ctx.Object(@6, buffers::parser::NodeType::OBJECT_VIS_SPEC, std::move($6), false)),
        }, false);
    }
  | vis_visualise_keyword vis_opt_source USING UMAP LRB vis_umap_spec_list RRB {
        if (!ctx.IsVisEnabled()) {
            error(@1, "VISUALISE syntax is disabled in this ParseContext");
            YYERROR;
        }
        ctx.MarkVisSpecSpan(@6);
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_VIS_VISUALISE, {
            Attr(Key::VIS_VISUALISE_SELECT, $2),
            Attr(Key::VIS_VISUALISE_USING, ctx.NameFromKeyword(@4, $4)),
            Attr(Key::VIS_VISUALISE_SPEC,
                 ctx.Object(@6, buffers::parser::NodeType::OBJECT_VIS_UMAP_SPEC, std::move($6), false)),
        }, false);
    }
  | vis_visualise_keyword vis_opt_source {
        if (!ctx.IsVisEnabled()) {
            error(@1, "VISUALISE syntax is disabled in this ParseContext");
            YYERROR;
        }
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_VIS_VISUALISE, {
            Attr(Key::VIS_VISUALISE_SELECT, $2),
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
// umap renderer spec
//
// Shape:
//   VISUALIZE t USING umap (
//       vector    => embedding,          -- required: column holding the high-dim vectors
//       category  => cluster_id,          -- optional: column → category color index
//       label     => customer_name,       -- optional: column shown in the tooltip
//       neighbors => 15,                   -- optional: UMAP nNeighbors
//       min_dist  => 0.1,                  -- optional: UMAP minDist
//       metric    => cosine                -- optional: distance metric
//   )
//
// The analyzer records only column names + projection params; the 2D UMAP projection
// itself runs client-side at render time (see the umap vis renderer).

vis_umap_spec_list:
    vis_umap_spec_list COMMA opt_vis_umap_spec_field  { $1->push_back($3); $$ = std::move($1); }
  | opt_vis_umap_spec_field                           { $$ = ctx.List({$1}); }
    ;

opt_vis_umap_spec_field:
    METRIC EQUALS_GREATER vis_umap_metric {
        $$ = Attr(Key::VIS_UMAP_SPEC_METRIC, $3);
    }
  | vis_umap_spec_num_key EQUALS_GREATER vis_umap_number {
        $$ = Attr($1, $3);
    }
  | vis_umap_spec_col_key EQUALS_GREATER vis_umap_column {
        $$ = Attr($1, $3);
    }
  | %empty { $$ = Null(); }
    ;

vis_umap_spec_col_key:
    VECTOR    { $$ = Key::VIS_UMAP_SPEC_VECTOR; }
  | CATEGORY  { $$ = Key::VIS_UMAP_SPEC_CATEGORY; }
  | LABEL     { $$ = Key::VIS_UMAP_SPEC_LABEL; }
    ;

vis_umap_spec_num_key:
    NEIGHBORS  { $$ = Key::VIS_UMAP_SPEC_NEIGHBORS; }
  | MIN_DIST   { $$ = Key::VIS_UMAP_SPEC_MIN_DIST; }
    ;

// A column reference in the umap spec (`embedding`, `t.embedding`) or a
// function expression over one (e.g. a cast), mirroring vega-lite field defs.
vis_umap_column:
    sql_columnref  { $$ = $1; }
  | sql_func_expr  { $$ = $1; }
    ;

// Closed keyword value-set: the parser validates the distance metric and offers it
// for autocompletion. Yields a NAME node carrying the keyword text, which the
// analyzer reads back (no dedicated enum type needed).
vis_umap_metric:
    COSINE     { $$ = ctx.NameFromKeyword(@1, $1); }
  | EUCLIDEAN  { $$ = ctx.NameFromKeyword(@1, $1); }
    ;

// Numeric projection parameters. Deliberately omits the nested-object production of
// `vis_value` so the umap grammar stays decoupled from the vega-lite body.
vis_umap_number:
    sql_a_expr_const                       { $$ = ctx.Expression(std::move($1)); }
  | PLUS sql_a_expr_const %prec UMINUS     { $$ = ctx.Expression(std::move($2)); }
  | MINUS sql_a_expr_const %prec UMINUS    { $$ = Negate(ctx, @$, @1, ctx.Expression(std::move($2))); }
    ;

// ---------------------------------------------------------------------------
// Level 1: Top-level spec fields

vis_spec_list:
    vis_spec_list COMMA opt_vis_spec_field  { $1->push_back($3); $$ = std::move($1); }
  | opt_vis_spec_field                      { $$ = ctx.List({$1}); }
    ;

opt_vis_spec_field:
    ENCODING EQUALS_GREATER LRB vis_encoding_list RRB {
        $$ = Attr(Key::VIS_SPEC_ENCODING,
             ctx.Object(@$, buffers::parser::NodeType::OBJECT_VIS_ENCODING, std::move($4), false));
    }
  | MARK EQUALS_GREATER vis_mark_value {
        $$ = Attr(Key::VIS_SPEC_MARK, $3);
    }
  | vis_spec_key EQUALS_GREATER vis_value {
        $$ = Attr($1, $3);
    }
  | %empty { $$ = Null(); }
    ;

vis_spec_key:
    LAYER           { $$ = Key::VIS_SPEC_LAYER; }
  | DATA_P          { $$ = Key::VIS_SPEC_DATA; }
  | TRANSFORM       { $$ = Key::VIS_SPEC_TRANSFORM; }
  | PARAMS          { $$ = Key::VIS_SPEC_PARAMS; }
  | PROJECTION      { $$ = Key::VIS_SPEC_PROJECTION; }
  | AUTOSIZE        { $$ = Key::VIS_SPEC_AUTOSIZE; }
  | RESOLVE         { $$ = Key::VIS_SPEC_RESOLVE; }
  | DATASETS        { $$ = Key::VIS_SPEC_DATASETS; }
  | VIEW            { $$ = Key::VIS_SPEC_VIEW; }
  | NAME_P          { $$ = Key::VIS_SPEC_NAME; }
  | TITLE           { $$ = Key::VIS_SPEC_TITLE; }
  | WIDTH           { $$ = Key::VIS_SPEC_WIDTH; }
  | HEIGHT          { $$ = Key::VIS_SPEC_HEIGHT; }
  | PADDING         { $$ = Key::VIS_SPEC_PADDING; }
  | BACKGROUND      { $$ = Key::VIS_SPEC_BACKGROUND; }
  | FILTER          { $$ = Key::VIS_SPEC_FILTER; }
  | DESCRIBE        { $$ = Key::VIS_SPEC_DESCRIPTION; }
  | TYPE_P          { $$ = Key::VIS_SPEC_TYPE; }
    ;

// A mark value is either a bare mark type (`mark => line`) or a structured mark
// definition object (`mark => (type => line, point => (...), filled => false)`).
// The object re-enters a dedicated vis_mark_list so bison reports mark-appropriate
// expected symbols for autocompletion, mirroring scale/axis/legend.
vis_mark_value:
    vis_mark_type {
        $$ = $1;
    }
  | LRB vis_mark_list RRB {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_VIS_MARK, std::move($2), false);
    }
    ;

vis_mark_list:
    vis_mark_list COMMA opt_vis_mark_field  { $1->push_back($3); $$ = std::move($1); }
  | opt_vis_mark_field                      { $$ = ctx.List({$1}); }
    ;

opt_vis_mark_field:
    TYPE_P EQUALS_GREATER vis_mark_type {
        $$ = Attr(Key::VIS_MARK_TYPE, $3);
    }
  | POINT EQUALS_GREATER vis_mark_overlay {
        $$ = Attr(Key::VIS_MARK_POINT, $3);
    }
  | LINE EQUALS_GREATER vis_mark_overlay {
        $$ = Attr(Key::VIS_MARK_LINE, $3);
    }
  | vis_mark_key EQUALS_GREATER vis_value {
        $$ = Attr($1, $3);
    }
  | %empty { $$ = Null(); }
    ;

// `point` and `line` overlays accept either a boolean toggle (`point => true`) or
// a nested mark definition object (`point => (filled => false, fill => 'white')`).
vis_mark_overlay:
    LRB vis_mark_list RRB {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_VIS_MARK, std::move($2), false);
    }
  | sql_a_expr_const {
        $$ = ctx.Expression(std::move($1));
    }
    ;

vis_mark_key:
    FILLED          { $$ = Key::VIS_MARK_FILLED; }
  | FILL            { $$ = Key::VIS_MARK_FILL; }
  | STROKE          { $$ = Key::VIS_MARK_STROKE; }
  | COLOR           { $$ = Key::VIS_MARK_COLOR; }
  | OPACITY         { $$ = Key::VIS_MARK_OPACITY; }
  | FILLOPACITY     { $$ = Key::VIS_MARK_FILL_OPACITY; }
  | STROKEOPACITY   { $$ = Key::VIS_MARK_STROKE_OPACITY; }
  | STROKEWIDTH     { $$ = Key::VIS_MARK_STROKE_WIDTH; }
  | STROKEDASH      { $$ = Key::VIS_MARK_STROKE_DASH; }
  | SIZE            { $$ = Key::VIS_MARK_SIZE; }
  | SHAPE           { $$ = Key::VIS_MARK_SHAPE; }
  | ANGLE           { $$ = Key::VIS_MARK_ANGLE; }
  | RADIUS          { $$ = Key::VIS_MARK_RADIUS; }
  | CORNERRADIUS    { $$ = Key::VIS_MARK_CORNER_RADIUS; }
  | ORIENT          { $$ = Key::VIS_MARK_ORIENT; }
  | INTERPOLATE     { $$ = Key::VIS_MARK_INTERPOLATE; }
  | TENSION         { $$ = Key::VIS_MARK_TENSION; }
  | THICKNESS       { $$ = Key::VIS_MARK_THICKNESS; }
  | TOOLTIP         { $$ = Key::VIS_MARK_TOOLTIP; }
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
        $$ = Attr($1,
             ctx.Object(@$, buffers::parser::NodeType::OBJECT_VIS_FIELD_DEF, std::move($4), false));
    }
  | vis_channel_key EQUALS_GREATER vis_encoding_value {
        $$ = Attr($1, $3);
    }
  | %empty { $$ = Null(); }
    ;

vis_channel_key:
    X_P               { $$ = Key::VIS_ENCODING_X; }
  | Y_P               { $$ = Key::VIS_ENCODING_Y; }
  | X2                { $$ = Key::VIS_ENCODING_X2; }
  | Y2                { $$ = Key::VIS_ENCODING_Y2; }
  | COLOR             { $$ = Key::VIS_ENCODING_COLOR; }
  | FILL              { $$ = Key::VIS_ENCODING_FILL; }
  | STROKE            { $$ = Key::VIS_ENCODING_STROKE; }
  | FILLOPACITY       { $$ = Key::VIS_ENCODING_FILL_OPACITY; }
  | STROKEOPACITY     { $$ = Key::VIS_ENCODING_STROKE_OPACITY; }
  | STROKEWIDTH       { $$ = Key::VIS_ENCODING_STROKE_WIDTH; }
  | STROKEDASH        { $$ = Key::VIS_ENCODING_STROKE_DASH; }
  | OPACITY           { $$ = Key::VIS_ENCODING_OPACITY; }
  | SIZE              { $$ = Key::VIS_ENCODING_SIZE; }
  | SHAPE             { $$ = Key::VIS_ENCODING_SHAPE; }
  | ANGLE             { $$ = Key::VIS_ENCODING_ANGLE; }
  | THETA             { $$ = Key::VIS_ENCODING_THETA; }
  | THETA2            { $$ = Key::VIS_ENCODING_THETA2; }
  | RADIUS            { $$ = Key::VIS_ENCODING_RADIUS; }
  | RADIUS2           { $$ = Key::VIS_ENCODING_RADIUS2; }
  | DETAIL            { $$ = Key::VIS_ENCODING_DETAIL; }
  | ORDER             { $$ = Key::VIS_ENCODING_ORDER; }
  | TOOLTIP           { $$ = Key::VIS_ENCODING_TOOLTIP; }
  | TEXT_P            { $$ = Key::VIS_ENCODING_TEXT; }
  | ROW               { $$ = Key::VIS_ENCODING_ROW; }
  | COLUMN            { $$ = Key::VIS_ENCODING_COLUMN; }
  | FACET             { $$ = Key::VIS_ENCODING_FACET; }
  | HREF              { $$ = Key::VIS_ENCODING_HREF; }
  | URL_P             { $$ = Key::VIS_ENCODING_URL; }
  | KEY               { $$ = Key::VIS_ENCODING_KEY; }
  | LATITUDE          { $$ = Key::VIS_ENCODING_LATITUDE; }
  | LONGITUDE         { $$ = Key::VIS_ENCODING_LONGITUDE; }
  | LATITUDE2         { $$ = Key::VIS_ENCODING_LATITUDE2; }
  | LONGITUDE2        { $$ = Key::VIS_ENCODING_LONGITUDE2; }
  | XOFFSET           { $$ = Key::VIS_ENCODING_X_OFFSET; }
  | YOFFSET           { $$ = Key::VIS_ENCODING_Y_OFFSET; }
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
        $$ = Attr(Key::VIS_FIELD_DEF_SCALE,
             ctx.Object(@$, buffers::parser::NodeType::OBJECT_VIS_SCALE, std::move($4), false));
    }
  | AXIS EQUALS_GREATER LRB vis_axis_list RRB {
        $$ = Attr(Key::VIS_FIELD_DEF_AXIS,
             ctx.Object(@$, buffers::parser::NodeType::OBJECT_VIS_AXIS, std::move($4), false));
    }
  | LEGEND EQUALS_GREATER LRB vis_legend_list RRB {
        $$ = Attr(Key::VIS_FIELD_DEF_LEGEND,
             ctx.Object(@$, buffers::parser::NodeType::OBJECT_VIS_LEGEND, std::move($4), false));
    }
  | TYPE_P EQUALS_GREATER vis_field_type {
        $$ = Attr(Key::VIS_FIELD_DEF_TYPE, $3);
    }
  | vis_fielddef_key EQUALS_GREATER vis_value {
        $$ = Attr($1, $3);
    }
  | %empty { $$ = Null(); }
    ;

vis_fielddef_key:
    FIELD           { $$ = Key::VIS_FIELD_DEF_FIELD; }
  | BIN             { $$ = Key::VIS_FIELD_DEF_BIN; }
  | AGGREGATE       { $$ = Key::VIS_FIELD_DEF_AGGREGATE; }
  | TIMEUNIT        { $$ = Key::VIS_FIELD_DEF_TIME_UNIT; }
  | SORT            { $$ = Key::VIS_FIELD_DEF_SORT; }
  | STACK           { $$ = Key::VIS_FIELD_DEF_STACK; }
  | IMPUTE          { $$ = Key::VIS_FIELD_DEF_IMPUTE; }
  | CONDITION       { $$ = Key::VIS_FIELD_DEF_CONDITION; }
  | TITLE           { $$ = Key::VIS_FIELD_DEF_TITLE; }
  | BANDPOSITION    { $$ = Key::VIS_FIELD_DEF_BAND_POSITION; }
  | DATUM           { $$ = Key::VIS_FIELD_DEF_DATUM; }
  | VALUE_P         { $$ = Key::VIS_FIELD_DEF_VALUE; }
  | FORMAT          { $$ = Key::VIS_FIELD_DEF_FORMAT; }
  | FORMATTYPE      { $$ = Key::VIS_FIELD_DEF_FORMAT_TYPE; }
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
    TYPE_P EQUALS_GREATER vis_scale_type {
        $$ = Attr(Key::VIS_SCALE_TYPE, $3);
    }
  | vis_scale_key EQUALS_GREATER vis_value {
        $$ = Attr($1, $3);
    }
  | %empty { $$ = Null(); }
    ;

vis_scale_type:
    LINEAR          { $$ = Enum(@1, buffers::parser::VisScaleType::LINEAR); }
  | LOG_P           { $$ = Enum(@1, buffers::parser::VisScaleType::LOG); }
  | POW             { $$ = Enum(@1, buffers::parser::VisScaleType::POW); }
  | SQRT            { $$ = Enum(@1, buffers::parser::VisScaleType::SQRT); }
  | SYMLOG          { $$ = Enum(@1, buffers::parser::VisScaleType::SYMLOG); }
  | IDENTITY_P      { $$ = Enum(@1, buffers::parser::VisScaleType::IDENTITY); }
  | SEQUENTIAL      { $$ = Enum(@1, buffers::parser::VisScaleType::SEQUENTIAL); }
  | TIME            { $$ = Enum(@1, buffers::parser::VisScaleType::TIME); }
  | UTC             { $$ = Enum(@1, buffers::parser::VisScaleType::UTC); }
  | QUANTILE        { $$ = Enum(@1, buffers::parser::VisScaleType::QUANTILE); }
  | QUANTIZE        { $$ = Enum(@1, buffers::parser::VisScaleType::QUANTIZE); }
  | THRESHOLD       { $$ = Enum(@1, buffers::parser::VisScaleType::THRESHOLD); }
  | ORDINAL         { $$ = Enum(@1, buffers::parser::VisScaleType::ORDINAL); }
  | BAND            { $$ = Enum(@1, buffers::parser::VisScaleType::BAND); }
  | POINT           { $$ = Enum(@1, buffers::parser::VisScaleType::POINT); }
  | sql_a_expr_const { $$ = ctx.Expression(std::move($1)); }
    ;

vis_scale_key:
    DOMAIN_P        { $$ = Key::VIS_SCALE_DOMAIN; }
  | DOMAINMIN       { $$ = Key::VIS_SCALE_DOMAIN_MIN; }
  | DOMAINMAX       { $$ = Key::VIS_SCALE_DOMAIN_MAX; }
  | DOMAINMID       { $$ = Key::VIS_SCALE_DOMAIN_MID; }
  | RANGE           { $$ = Key::VIS_SCALE_RANGE; }
  | RANGEMIN        { $$ = Key::VIS_SCALE_RANGE_MIN; }
  | RANGEMAX        { $$ = Key::VIS_SCALE_RANGE_MAX; }
  | SCHEME          { $$ = Key::VIS_SCALE_SCHEME; }
  | INTERPOLATE     { $$ = Key::VIS_SCALE_INTERPOLATE; }
  | NICE            { $$ = Key::VIS_SCALE_NICE; }
  | ZERO            { $$ = Key::VIS_SCALE_ZERO; }
  | CLAMP           { $$ = Key::VIS_SCALE_CLAMP; }
  | PADDING         { $$ = Key::VIS_SCALE_PADDING; }
  | PADDINGINNER    { $$ = Key::VIS_SCALE_PADDING_INNER; }
  | PADDINGOUTER    { $$ = Key::VIS_SCALE_PADDING_OUTER; }
  | REVERSE         { $$ = Key::VIS_SCALE_REVERSE; }
  | ROUND           { $$ = Key::VIS_SCALE_ROUND; }
  | EXPONENT        { $$ = Key::VIS_SCALE_EXPONENT; }
  | BINS            { $$ = Key::VIS_SCALE_BINS; }
  | NAME_P          { $$ = Key::VIS_SCALE_NAME; }
    ;

// ---------------------------------------------------------------------------
// Level 4: Axis properties

vis_axis_list:
    vis_axis_list COMMA opt_vis_axis_field  { $1->push_back($3); $$ = std::move($1); }
  | opt_vis_axis_field                      { $$ = ctx.List({$1}); }
    ;

opt_vis_axis_field:
    vis_axis_key EQUALS_GREATER vis_value {
        $$ = Attr($1, $3);
    }
  | %empty { $$ = Null(); }
    ;

vis_axis_key:
    ORIENT          { $$ = Key::VIS_AXIS_ORIENT; }
  | FORMAT          { $$ = Key::VIS_AXIS_FORMAT; }
  | FORMATTYPE      { $$ = Key::VIS_AXIS_FORMAT_TYPE; }
  | GRID            { $$ = Key::VIS_AXIS_GRID; }
  | TICKS           { $$ = Key::VIS_AXIS_TICKS; }
  | TICKCOUNT       { $$ = Key::VIS_AXIS_TICK_COUNT; }
  | TICKSIZE        { $$ = Key::VIS_AXIS_TICK_SIZE; }
  | LABELANGLE      { $$ = Key::VIS_AXIS_LABEL_ANGLE; }
  | LABELFONTSIZE   { $$ = Key::VIS_AXIS_LABEL_FONT_SIZE; }
  | LABELOVERLAP    { $$ = Key::VIS_AXIS_LABEL_OVERLAP; }
  | DIRECTION       { $$ = Key::VIS_AXIS_DIRECTION; }
  | OFFSET          { $$ = Key::VIS_AXIS_OFFSET; }
  | VALUES          { $$ = Key::VIS_AXIS_VALUES; }
  | ZINDEX          { $$ = Key::VIS_AXIS_ZINDEX; }
  | TITLE           { $$ = Key::VIS_AXIS_TITLE; }
  | DOMAIN_P        { $$ = Key::VIS_AXIS_DOMAIN; }
  | NAME_P          { $$ = Key::VIS_AXIS_NAME; }
    ;

// ---------------------------------------------------------------------------
// Level 4: Legend properties

vis_legend_list:
    vis_legend_list COMMA opt_vis_legend_field  { $1->push_back($3); $$ = std::move($1); }
  | opt_vis_legend_field                        { $$ = ctx.List({$1}); }
    ;

opt_vis_legend_field:
    vis_legend_key EQUALS_GREATER vis_value {
        $$ = Attr($1, $3);
    }
  | %empty { $$ = Null(); }
    ;

vis_legend_key:
    TYPE_P          { $$ = Key::VIS_LEGEND_TYPE; }
  | ORIENT          { $$ = Key::VIS_LEGEND_ORIENT; }
  | FORMAT          { $$ = Key::VIS_LEGEND_FORMAT; }
  | FORMATTYPE      { $$ = Key::VIS_LEGEND_FORMAT_TYPE; }
  | DIRECTION       { $$ = Key::VIS_LEGEND_DIRECTION; }
  | TITLE           { $$ = Key::VIS_LEGEND_TITLE; }
  | VALUES          { $$ = Key::VIS_LEGEND_VALUES; }
  | PADDING         { $$ = Key::VIS_LEGEND_PADDING; }
  | OFFSET          { $$ = Key::VIS_LEGEND_OFFSET; }
  | ZINDEX          { $$ = Key::VIS_LEGEND_ZINDEX; }
  | NAME_P          { $$ = Key::VIS_LEGEND_NAME; }
    ;

// ---------------------------------------------------------------------------
// Generic value rule (used at levels 1, 3, and inside scale/axis/legend)
//
// Nested objects re-enter vis_spec_list so autocompletion suggests top-level
// spec keys. The vis_encoding_value variant omits the nested-object production
// to avoid reduce/reduce with the structural channel path at level 2.

vis_value:
    LRB vis_spec_list RRB {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_VIS_SPEC, std::move($2), false);
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

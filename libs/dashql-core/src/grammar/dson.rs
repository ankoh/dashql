use crate::{
    error::SystemError,
    execution::{
        constant_folding::evaluate_constant_expression, execution_context::ExecutionContextSnapshot,
        scalar_value::scalar_to_json,
    },
};

use super::ast_nodes_sql::*;
use dashql_proto as proto;
use serde::{ser::SerializeMap, Serialize};
use serde_json as sj;

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub enum DsonKey<'arena> {
    Known(proto::AttributeKey),
    Unknown(&'arena str),
}

impl<'arena> Default for DsonKey<'arena> {
    fn default() -> Self {
        Self::Unknown("")
    }
}

impl<'arena> DsonKey<'arena> {
    pub fn as_str(&self) -> &'arena str {
        match self {
            DsonKey::Known(k) => match *k {
                proto::AttributeKey::DSON_AGGREGATE => "aggregate",
                proto::AttributeKey::DSON_ALIGN => "align",
                proto::AttributeKey::DSON_ANCHOR => "anchor",
                proto::AttributeKey::DSON_ANGLE => "angle",
                proto::AttributeKey::DSON_ARC => "arc",
                proto::AttributeKey::DSON_ARIA => "aria",
                proto::AttributeKey::DSON_AS => "as",
                proto::AttributeKey::DSON_AXIS => "axis",
                proto::AttributeKey::DSON_BAND_PADDING_INNER => "band_padding_inner",
                proto::AttributeKey::DSON_BAND_PADDING_OUTER => "band_padding_outer",
                proto::AttributeKey::DSON_BAND_POSITION => "band_position",
                proto::AttributeKey::DSON_BANDWIDTH => "bandwidth",
                proto::AttributeKey::DSON_BAR_BAND_PADDING_INNER => "bar_band_padding_inner",
                proto::AttributeKey::DSON_BASELINE => "baseline",
                proto::AttributeKey::DSON_BIN => "bin",
                proto::AttributeKey::DSON_BIN_SPACING => "bin_spacing",
                proto::AttributeKey::DSON_BINNED => "binned",
                proto::AttributeKey::DSON_BLEND => "blend",
                proto::AttributeKey::DSON_BORDERS => "borders",
                proto::AttributeKey::DSON_BOUNDS => "bounds",
                proto::AttributeKey::DSON_CATEGORY => "category",
                proto::AttributeKey::DSON_CENTER => "center",
                proto::AttributeKey::DSON_CIRCLE => "circle",
                proto::AttributeKey::DSON_CLAMP => "clamp",
                proto::AttributeKey::DSON_CLIP => "clip",
                proto::AttributeKey::DSON_CLIP_HEIGHT => "clip_height",
                proto::AttributeKey::DSON_COLOR => "color",
                proto::AttributeKey::DSON_COLUMN => "column",
                proto::AttributeKey::DSON_COLUMN_PADDING => "column_padding",
                proto::AttributeKey::DSON_CONDITION => "condition",
                proto::AttributeKey::DSON_CONFIG => "config",
                proto::AttributeKey::DSON_CONSTANT => "constant",
                proto::AttributeKey::DSON_CONTINUOUS_BAND_SIZE => "continuous_band_size",
                proto::AttributeKey::DSON_CONTINUOUS_PADDING => "continuous_padding",
                proto::AttributeKey::DSON_CORNER_RADIUS => "corner_radius",
                proto::AttributeKey::DSON_CORNER_RADIUS_BOTTOM_LEFT => "corner_radius_bottom_left",
                proto::AttributeKey::DSON_CORNER_RADIUS_BOTTOM_RIGHT => "corner_radius_bottom_right",
                proto::AttributeKey::DSON_CORNER_RADIUS_END => "corner_radius_end",
                proto::AttributeKey::DSON_CORNER_RADIUS_TOP_LEFT => "corner_radius_top_left",
                proto::AttributeKey::DSON_CORNER_RADIUS_TOP_RIGHT => "corner_radius_top_right",
                proto::AttributeKey::DSON_COUNT => "count",
                proto::AttributeKey::DSON_CUMULATIVE => "cumulative",
                proto::AttributeKey::DSON_CURSOR => "cursor",
                proto::AttributeKey::DSON_DASHQL => "dashql",
                proto::AttributeKey::DSON_DATA => "data",
                proto::AttributeKey::DSON_DATUM => "datum",
                proto::AttributeKey::DSON_DEFAULT => "default",
                proto::AttributeKey::DSON_DELIMITER => "delimiter",
                proto::AttributeKey::DSON_DENSITY => "density",
                proto::AttributeKey::DSON_DESCRIPTION => "description",
                proto::AttributeKey::DSON_DETAIL => "detail",
                proto::AttributeKey::DSON_DIR => "dir",
                proto::AttributeKey::DSON_DISCRETE_BAND_SIZE => "discrete_band_size",
                proto::AttributeKey::DSON_DIVERGING => "diverging",
                proto::AttributeKey::DSON_DIVIDE => "divide",
                proto::AttributeKey::DSON_DOMAIN => "domain",
                proto::AttributeKey::DSON_DOMAIN_MAX => "domain_max",
                proto::AttributeKey::DSON_DOMAIN_MID => "domain_mid",
                proto::AttributeKey::DSON_DOMAIN_MIN => "domain_min",
                proto::AttributeKey::DSON_DX => "dx",
                proto::AttributeKey::DSON_DY => "dy",
                proto::AttributeKey::DSON_ELLIPSIS => "ellipsis",
                proto::AttributeKey::DSON_ENCODING => "encoding",
                proto::AttributeKey::DSON_ERRORBAND => "errorband",
                proto::AttributeKey::DSON_EXPRESSION => "expression",
                proto::AttributeKey::DSON_EXTENT => "extent",
                proto::AttributeKey::DSON_EXTENT_MAJOR => "extent_major",
                proto::AttributeKey::DSON_EXTENT_MINOR => "extent_minor",
                proto::AttributeKey::DSON_FEATURE => "feature",
                proto::AttributeKey::DSON_FIELD => "field",
                proto::AttributeKey::DSON_FIELDS => "fields",
                proto::AttributeKey::DSON_FILL => "fill",
                proto::AttributeKey::DSON_FILL_OPACITY => "fill_opacity",
                proto::AttributeKey::DSON_FILLED => "filled",
                proto::AttributeKey::DSON_FILTER => "filter",
                proto::AttributeKey::DSON_FOLD => "fold",
                proto::AttributeKey::DSON_FONT => "font",
                proto::AttributeKey::DSON_FONT_SIZE => "font_size",
                proto::AttributeKey::DSON_FONT_STYLE => "font_style",
                proto::AttributeKey::DSON_FONT_WEIGHT => "font_weight",
                proto::AttributeKey::DSON_FORMAT => "format",
                proto::AttributeKey::DSON_FORMAT_TYPE => "format_type",
                proto::AttributeKey::DSON_FRAME => "frame",
                proto::AttributeKey::DSON_GEOSHAPE => "geoshape",
                proto::AttributeKey::DSON_GRADIENT => "gradient",
                proto::AttributeKey::DSON_GRADIENT_DIRECTION => "gradient_direction",
                proto::AttributeKey::DSON_GRADIENT_HORIZONTAL_MAX_LENGTH => "gradient_horizontal_max_length",
                proto::AttributeKey::DSON_GRADIENT_HORIZONTAL_MIN_LENGTH => "gradient_horizontal_min_length",
                proto::AttributeKey::DSON_GRADIENT_LABEL_LIMIT => "gradient_label_limit",
                proto::AttributeKey::DSON_GRADIENT_LABEL_OFFSET => "gradient_label_offset",
                proto::AttributeKey::DSON_GRADIENT_LENGTH => "gradient_length",
                proto::AttributeKey::DSON_GRADIENT_OPACITY => "gradient_opacity",
                proto::AttributeKey::DSON_GRADIENT_STROKE_COLOR => "gradient_stroke_color",
                proto::AttributeKey::DSON_GRADIENT_STROKE_THICKNESS => "gradient_stroke_thickness",
                proto::AttributeKey::DSON_GRADIENT_STROKE_WIDTH => "gradient_stroke_width",
                proto::AttributeKey::DSON_GRADIENT_VERTICAL_MAX_LENGTH => "gradient_vertical_max_length",
                proto::AttributeKey::DSON_GRADIENT_VERTICAL_MIN_LENGTH => "gradient_vertical_min_length",
                proto::AttributeKey::DSON_GRATICULE => "graticule",
                proto::AttributeKey::DSON_GRID => "grid",
                proto::AttributeKey::DSON_GRID_ALIGN => "grid_align",
                proto::AttributeKey::DSON_GROUPBY => "groupby",
                proto::AttributeKey::DSON_HEADER => "header",
                proto::AttributeKey::DSON_HEATMAP => "heatmap",
                proto::AttributeKey::DSON_HEIGHT => "height",
                proto::AttributeKey::DSON_HREF => "href",
                proto::AttributeKey::DSON_IGNORE_PEERS => "ignore_peers",
                proto::AttributeKey::DSON_INNER_RADIUS => "inner_radius",
                proto::AttributeKey::DSON_INTERPOLATE => "interpolate",
                proto::AttributeKey::DSON_INVALID => "invalid",
                proto::AttributeKey::DSON_JOINAGGREGATE => "joinaggregate",
                proto::AttributeKey::DSON_KEY => "key",
                proto::AttributeKey::DSON_KEYVALS => "keyvals",
                proto::AttributeKey::DSON_LABEL => "label",
                proto::AttributeKey::DSON_LABEL_ALIGN => "label_align",
                proto::AttributeKey::DSON_LABEL_ANCHOR => "label_anchor",
                proto::AttributeKey::DSON_LABEL_ANGLE => "label_angle",
                proto::AttributeKey::DSON_LABEL_BASELINE => "label_baseline",
                proto::AttributeKey::DSON_LABEL_COLOR => "label_color",
                proto::AttributeKey::DSON_LABEL_EXPR => "label_expr",
                proto::AttributeKey::DSON_LABEL_FONT => "label_font",
                proto::AttributeKey::DSON_LABEL_FONT_SIZE => "label_font_size",
                proto::AttributeKey::DSON_LABEL_FONT_WEIGHT => "label_font_weight",
                proto::AttributeKey::DSON_LABEL_LIMIT => "label_limit",
                proto::AttributeKey::DSON_LABEL_LINE_HEIGHT => "label_line_height",
                proto::AttributeKey::DSON_LABEL_ORIENT => "label_orient",
                proto::AttributeKey::DSON_LABEL_OVERLAP => "label_overlap",
                proto::AttributeKey::DSON_LABEL_PADDING => "label_padding",
                proto::AttributeKey::DSON_LATITUDE => "latitude",
                proto::AttributeKey::DSON_LAYER => "layer",
                proto::AttributeKey::DSON_LEGEND => "legend",
                proto::AttributeKey::DSON_LIMIT => "limit",
                proto::AttributeKey::DSON_LINE => "line",
                proto::AttributeKey::DSON_LINE_HEIGHT => "line_height",
                proto::AttributeKey::DSON_LOESS => "loess",
                proto::AttributeKey::DSON_LONGITUDE => "longitude",
                proto::AttributeKey::DSON_MARK => "mark",
                proto::AttributeKey::DSON_MAX_BAND_SIZE => "max_band_size",
                proto::AttributeKey::DSON_MAX_EXTENT => "max_extent",
                proto::AttributeKey::DSON_MAX_FONT_SIZE => "max_font_size",
                proto::AttributeKey::DSON_MAX_OPACITY => "max_opacity",
                proto::AttributeKey::DSON_MAX_SIZE => "max_size",
                proto::AttributeKey::DSON_MAX_STROKE_WIDTH => "max_stroke_width",
                proto::AttributeKey::DSON_MAXBINS => "maxbins",
                proto::AttributeKey::DSON_MESH => "mesh",
                proto::AttributeKey::DSON_METHOD => "method",
                proto::AttributeKey::DSON_MIN_BAND_SIZE => "min_band_size",
                proto::AttributeKey::DSON_MIN_EXTENT => "min_extent",
                proto::AttributeKey::DSON_MIN_FONT_SIZE => "min_font_size",
                proto::AttributeKey::DSON_MIN_OPACITY => "min_opacity",
                proto::AttributeKey::DSON_MIN_SIZE => "min_size",
                proto::AttributeKey::DSON_MIN_STROKE_WIDTH => "min_stroke_width",
                proto::AttributeKey::DSON_MINSTEP => "minstep",
                proto::AttributeKey::DSON_NICE => "nice",
                proto::AttributeKey::DSON_NOT => "not",
                proto::AttributeKey::DSON_OFFSET => "offset",
                proto::AttributeKey::DSON_ON => "on",
                proto::AttributeKey::DSON_OP => "op",
                proto::AttributeKey::DSON_OPACITY => "opacity",
                proto::AttributeKey::DSON_ORDINAL => "ordinal",
                proto::AttributeKey::DSON_ORIENT => "orient",
                proto::AttributeKey::DSON_OUTER_RADIUS => "outer_radius",
                proto::AttributeKey::DSON_PAD_ANGLE => "pad_angle",
                proto::AttributeKey::DSON_PADDING => "padding",
                proto::AttributeKey::DSON_PADDING_INNER => "padding_inner",
                proto::AttributeKey::DSON_PADDING_OUTER => "padding_outer",
                proto::AttributeKey::DSON_PARAM => "param",
                proto::AttributeKey::DSON_PARAMS => "params",
                proto::AttributeKey::DSON_PARSE => "parse",
                proto::AttributeKey::DSON_PIVOT => "pivot",
                proto::AttributeKey::DSON_POINT => "point",
                proto::AttributeKey::DSON_POINT_PADDING => "point_padding",
                proto::AttributeKey::DSON_POSITION => "position",
                proto::AttributeKey::DSON_EXTENT_PRECISION => "precision",
                proto::AttributeKey::DSON_PROB => "prob",
                proto::AttributeKey::DSON_PROBS => "probs",
                proto::AttributeKey::DSON_PROJECTION => "projection",
                proto::AttributeKey::DSON_QUANTILE => "quantile",
                proto::AttributeKey::DSON_RADIUS => "radius",
                proto::AttributeKey::DSON_RADIUS2 => "radius2",
                proto::AttributeKey::DSON_RADIUS2_OFFSET => "radius2_offset",
                proto::AttributeKey::DSON_RADIUS_OFFSET => "radius_offset",
                proto::AttributeKey::DSON_RAMP => "ramp",
                proto::AttributeKey::DSON_RANGE => "range",
                proto::AttributeKey::DSON_RANGE_MAX => "range_max",
                proto::AttributeKey::DSON_RANGE_MIN => "range_min",
                proto::AttributeKey::DSON_RECT => "rect",
                proto::AttributeKey::DSON_RECT_BAND_PADDING_INNER => "rect_band_padding_inner",
                proto::AttributeKey::DSON_REVERSE => "reverse",
                proto::AttributeKey::DSON_ROUND => "round",
                proto::AttributeKey::DSON_ROW => "row",
                proto::AttributeKey::DSON_ROW_PADDING => "row_padding",
                proto::AttributeKey::DSON_SCALE => "scale",
                proto::AttributeKey::DSON_SCHEMA => "schema",
                proto::AttributeKey::DSON_SHAPE => "shape",
                proto::AttributeKey::DSON_SIZE => "size",
                proto::AttributeKey::DSON_SPACING => "spacing",
                proto::AttributeKey::DSON_STACK => "stack",
                proto::AttributeKey::DSON_STACKED => "stacked",
                proto::AttributeKey::DSON_START => "start",
                proto::AttributeKey::DSON_STROKE_STEP => "step",
                proto::AttributeKey::DSON_STEP_MAJOR => "step_major",
                proto::AttributeKey::DSON_STEP_MINOR => "step_minor",
                proto::AttributeKey::DSON_STEPS => "steps",
                proto::AttributeKey::DSON_STOP => "stop",
                proto::AttributeKey::DSON_STROKE => "stroke",
                proto::AttributeKey::DSON_STROKE_CAP => "stroke_cap",
                proto::AttributeKey::DSON_STROKE_DASH => "stroke_dash",
                proto::AttributeKey::DSON_STROKE_DASH_OFFSET => "stroke_dash_offset",
                proto::AttributeKey::DSON_STROKE_JOIN => "stroke_join",
                proto::AttributeKey::DSON_STROKE_MITER_LIMIT => "stroke_miter_limit",
                proto::AttributeKey::DSON_STROKE_OPACITY => "stroke_opacity",
                proto::AttributeKey::DSON_STROKE_WIDTH => "stroke_width",
                proto::AttributeKey::DSON_STYLE => "style",
                proto::AttributeKey::DSON_SUBTITLE => "subtitle",
                proto::AttributeKey::DSON_SUBTITLE_COLOR => "subtitle_color",
                proto::AttributeKey::DSON_SUBTITLE_FONT => "subtitle_font",
                proto::AttributeKey::DSON_SUBTITLE_FONT_SIZE => "subtitle_font_size",
                proto::AttributeKey::DSON_SUBTITLE_FONT_STYLE => "subtitle_font_style",
                proto::AttributeKey::DSON_SUBTITLE_FONT_WEIGHT => "subtitle_font_weight",
                proto::AttributeKey::DSON_SUBTITLE_LINE_HEIGHT => "subtitle_line_height",
                proto::AttributeKey::DSON_SUBTITLE_PADDING => "subtitle_padding",
                proto::AttributeKey::DSON_SYMBOL => "symbol",
                proto::AttributeKey::DSON_SYMBOL_BASE_FILL_COLOR => "symbol_base_fill_color",
                proto::AttributeKey::DSON_SYMBOL_BASE_STROKE_COLOR => "symbol_base_stroke_color",
                proto::AttributeKey::DSON_SYMBOL_DASH => "symbol_dash",
                proto::AttributeKey::DSON_SYMBOL_DASH_OFFSET => "symbol_dash_offset",
                proto::AttributeKey::DSON_SYMBOL_DIRECTION => "symbol_direction",
                proto::AttributeKey::DSON_SYMBOL_FILL_COLOR => "symbol_fill_color",
                proto::AttributeKey::DSON_SYMBOL_LIMIT => "symbol_limit",
                proto::AttributeKey::DSON_SYMBOL_OFFSET => "symbol_offset",
                proto::AttributeKey::DSON_SYMBOL_OPACITY => "symbol_opacity",
                proto::AttributeKey::DSON_SYMBOL_SIZE => "symbol_size",
                proto::AttributeKey::DSON_SYMBOL_STROKE_COLOR => "symbol_stroke_color",
                proto::AttributeKey::DSON_SYMBOL_STROKE_WIDTH => "symbol_stroke_width",
                proto::AttributeKey::DSON_SYMBOL_TYPE => "symbol_type",
                proto::AttributeKey::DSON_TENSION => "tension",
                proto::AttributeKey::DSON_TEST => "test",
                proto::AttributeKey::DSON_TEXT => "text",
                proto::AttributeKey::DSON_THETA => "theta",
                proto::AttributeKey::DSON_THETA2 => "theta2",
                proto::AttributeKey::DSON_THETA2_OFFSET => "theta2_offset",
                proto::AttributeKey::DSON_THETA_OFFSET => "theta_offset",
                proto::AttributeKey::DSON_TICKNESS => "thickness",
                proto::AttributeKey::DSON_TICK_BAND => "tick_band",
                proto::AttributeKey::DSON_TICK_COUNT => "tick_count",
                proto::AttributeKey::DSON_TICK_EXTRA => "tick_extra",
                proto::AttributeKey::DSON_TICK_MIN_STEP => "tick_min_step",
                proto::AttributeKey::DSON_TICK_OFFSET => "tick_offset",
                proto::AttributeKey::DSON_TICK_OPACITY => "tick_opacity",
                proto::AttributeKey::DSON_TICK_SIZE => "tick_size",
                proto::AttributeKey::DSON_TIME_UNIT => "time_unit",
                proto::AttributeKey::DSON_TITLE => "title",
                proto::AttributeKey::DSON_TOOLTIP => "tooltip",
                proto::AttributeKey::DSON_TRAIL => "trail",
                proto::AttributeKey::DSON_TRANSLATE => "translate",
                proto::AttributeKey::DSON_TYPE => "type",
                proto::AttributeKey::DSON_UNSELECTED_OPACITY => "unselected_opacity",
                proto::AttributeKey::DSON_URL => "url",
                proto::AttributeKey::DSON_USE_UNAGGREGATED_DOMAIN => "use_unaggregated_domain",
                proto::AttributeKey::DSON_USERMETA => "usermeta",
                proto::AttributeKey::DSON_VALUE => "value",
                proto::AttributeKey::DSON_VIEW => "view",
                proto::AttributeKey::DSON_WIDTH => "width",
                proto::AttributeKey::DSON_X => "x",
                proto::AttributeKey::DSON_X2 => "x2",
                proto::AttributeKey::DSON_X2_OFFSET => "x2_offset",
                proto::AttributeKey::DSON_X_OFFSET => "x_offset",
                proto::AttributeKey::DSON_X_REVERSE => "x_reverse",
                proto::AttributeKey::DSON_Y => "y",
                proto::AttributeKey::DSON_Y2 => "y2",
                proto::AttributeKey::DSON_Y2_OFFSET => "y2_offset",
                proto::AttributeKey::DSON_Y_OFFSET => "y_offset",
                proto::AttributeKey::DSON_ZERO => "zero",
                proto::AttributeKey::DSON_ZINDEX => "zindex",
                _ => todo!(),
            },
            DsonKey::Unknown(s) => s,
        }
    }

    pub fn from_str(s: &str, arena: &'arena bumpalo::Bump) -> Self {
        // TODO this should be exposed in the parser
        let known = match s {
            "aggregate" => proto::AttributeKey::DSON_AGGREGATE,
            "align" => proto::AttributeKey::DSON_ALIGN,
            "anchor" => proto::AttributeKey::DSON_ANCHOR,
            "angle" => proto::AttributeKey::DSON_ANGLE,
            "arc" => proto::AttributeKey::DSON_ARC,
            "aria" => proto::AttributeKey::DSON_ARIA,
            "as" => proto::AttributeKey::DSON_AS,
            "axis" => proto::AttributeKey::DSON_AXIS,
            "band_padding_inner" => proto::AttributeKey::DSON_BAND_PADDING_INNER,
            "band_padding_outer" => proto::AttributeKey::DSON_BAND_PADDING_OUTER,
            "band_position" => proto::AttributeKey::DSON_BAND_POSITION,
            "bandwidth" => proto::AttributeKey::DSON_BANDWIDTH,
            "bar_band_padding_inner" => proto::AttributeKey::DSON_BAR_BAND_PADDING_INNER,
            "baseline" => proto::AttributeKey::DSON_BASELINE,
            "bin" => proto::AttributeKey::DSON_BIN,
            "bin_spacing" => proto::AttributeKey::DSON_BIN_SPACING,
            "binned" => proto::AttributeKey::DSON_BINNED,
            "blend" => proto::AttributeKey::DSON_BLEND,
            "borders" => proto::AttributeKey::DSON_BORDERS,
            "bounds" => proto::AttributeKey::DSON_BOUNDS,
            "category" => proto::AttributeKey::DSON_CATEGORY,
            "center" => proto::AttributeKey::DSON_CENTER,
            "circle" => proto::AttributeKey::DSON_CIRCLE,
            "clamp" => proto::AttributeKey::DSON_CLAMP,
            "clip" => proto::AttributeKey::DSON_CLIP,
            "clip_height" => proto::AttributeKey::DSON_CLIP_HEIGHT,
            "color" => proto::AttributeKey::DSON_COLOR,
            "column" => proto::AttributeKey::DSON_COLUMN,
            "column_padding" => proto::AttributeKey::DSON_COLUMN_PADDING,
            "condition" => proto::AttributeKey::DSON_CONDITION,
            "config" => proto::AttributeKey::DSON_CONFIG,
            "constant" => proto::AttributeKey::DSON_CONSTANT,
            "continuous_band_size" => proto::AttributeKey::DSON_CONTINUOUS_BAND_SIZE,
            "continuous_padding" => proto::AttributeKey::DSON_CONTINUOUS_PADDING,
            "corner_radius" => proto::AttributeKey::DSON_CORNER_RADIUS,
            "corner_radius_bottom_left" => proto::AttributeKey::DSON_CORNER_RADIUS_BOTTOM_LEFT,
            "corner_radius_bottom_right" => proto::AttributeKey::DSON_CORNER_RADIUS_BOTTOM_RIGHT,
            "corner_radius_end" => proto::AttributeKey::DSON_CORNER_RADIUS_END,
            "corner_radius_top_left" => proto::AttributeKey::DSON_CORNER_RADIUS_TOP_LEFT,
            "corner_radius_top_right" => proto::AttributeKey::DSON_CORNER_RADIUS_TOP_RIGHT,
            "count" => proto::AttributeKey::DSON_COUNT,
            "cumulative" => proto::AttributeKey::DSON_CUMULATIVE,
            "cursor" => proto::AttributeKey::DSON_CURSOR,
            "dashql" => proto::AttributeKey::DSON_DASHQL,
            "data" => proto::AttributeKey::DSON_DATA,
            "datum" => proto::AttributeKey::DSON_DATUM,
            "default" => proto::AttributeKey::DSON_DEFAULT,
            "delimiter" => proto::AttributeKey::DSON_DELIMITER,
            "density" => proto::AttributeKey::DSON_DENSITY,
            "description" => proto::AttributeKey::DSON_DESCRIPTION,
            "detail" => proto::AttributeKey::DSON_DETAIL,
            "dir" => proto::AttributeKey::DSON_DIR,
            "discrete_band_size" => proto::AttributeKey::DSON_DISCRETE_BAND_SIZE,
            "diverging" => proto::AttributeKey::DSON_DIVERGING,
            "divide" => proto::AttributeKey::DSON_DIVIDE,
            "domain" => proto::AttributeKey::DSON_DOMAIN,
            "domain_max" => proto::AttributeKey::DSON_DOMAIN_MAX,
            "domain_mid" => proto::AttributeKey::DSON_DOMAIN_MID,
            "domain_min" => proto::AttributeKey::DSON_DOMAIN_MIN,
            "dx" => proto::AttributeKey::DSON_DX,
            "dy" => proto::AttributeKey::DSON_DY,
            "ellipsis" => proto::AttributeKey::DSON_ELLIPSIS,
            "encoding" => proto::AttributeKey::DSON_ENCODING,
            "errorband" => proto::AttributeKey::DSON_ERRORBAND,
            "expression" => proto::AttributeKey::DSON_EXPRESSION,
            "extent" => proto::AttributeKey::DSON_EXTENT,
            "extent_major" => proto::AttributeKey::DSON_EXTENT_MAJOR,
            "extent_minor" => proto::AttributeKey::DSON_EXTENT_MINOR,
            "feature" => proto::AttributeKey::DSON_FEATURE,
            "field" => proto::AttributeKey::DSON_FIELD,
            "fields" => proto::AttributeKey::DSON_FIELDS,
            "fill" => proto::AttributeKey::DSON_FILL,
            "fill_opacity" => proto::AttributeKey::DSON_FILL_OPACITY,
            "filled" => proto::AttributeKey::DSON_FILLED,
            "filter" => proto::AttributeKey::DSON_FILTER,
            "fold" => proto::AttributeKey::DSON_FOLD,
            "font" => proto::AttributeKey::DSON_FONT,
            "font_size" => proto::AttributeKey::DSON_FONT_SIZE,
            "font_style" => proto::AttributeKey::DSON_FONT_STYLE,
            "font_weight" => proto::AttributeKey::DSON_FONT_WEIGHT,
            "format" => proto::AttributeKey::DSON_FORMAT,
            "format_type" => proto::AttributeKey::DSON_FORMAT_TYPE,
            "frame" => proto::AttributeKey::DSON_FRAME,
            "geoshape" => proto::AttributeKey::DSON_GEOSHAPE,
            "gradient" => proto::AttributeKey::DSON_GRADIENT,
            "gradient_direction" => proto::AttributeKey::DSON_GRADIENT_DIRECTION,
            "gradient_horizontal_max_length" => proto::AttributeKey::DSON_GRADIENT_HORIZONTAL_MAX_LENGTH,
            "gradient_horizontal_min_length" => proto::AttributeKey::DSON_GRADIENT_HORIZONTAL_MIN_LENGTH,
            "gradient_label_limit" => proto::AttributeKey::DSON_GRADIENT_LABEL_LIMIT,
            "gradient_label_offset" => proto::AttributeKey::DSON_GRADIENT_LABEL_OFFSET,
            "gradient_length" => proto::AttributeKey::DSON_GRADIENT_LENGTH,
            "gradient_opacity" => proto::AttributeKey::DSON_GRADIENT_OPACITY,
            "gradient_stroke_color" => proto::AttributeKey::DSON_GRADIENT_STROKE_COLOR,
            "gradient_stroke_thickness" => proto::AttributeKey::DSON_GRADIENT_STROKE_THICKNESS,
            "gradient_stroke_width" => proto::AttributeKey::DSON_GRADIENT_STROKE_WIDTH,
            "gradient_vertical_max_length" => proto::AttributeKey::DSON_GRADIENT_VERTICAL_MAX_LENGTH,
            "gradient_vertical_min_length" => proto::AttributeKey::DSON_GRADIENT_VERTICAL_MIN_LENGTH,
            "graticule" => proto::AttributeKey::DSON_GRATICULE,
            "grid" => proto::AttributeKey::DSON_GRID,
            "grid_align" => proto::AttributeKey::DSON_GRID_ALIGN,
            "groupby" => proto::AttributeKey::DSON_GROUPBY,
            "header" => proto::AttributeKey::DSON_HEADER,
            "heatmap" => proto::AttributeKey::DSON_HEATMAP,
            "height" => proto::AttributeKey::DSON_HEIGHT,
            "href" => proto::AttributeKey::DSON_HREF,
            "ignore_peers" => proto::AttributeKey::DSON_IGNORE_PEERS,
            "inner_radius" => proto::AttributeKey::DSON_INNER_RADIUS,
            "interpolate" => proto::AttributeKey::DSON_INTERPOLATE,
            "invalid" => proto::AttributeKey::DSON_INVALID,
            "joinaggregate" => proto::AttributeKey::DSON_JOINAGGREGATE,
            "key" => proto::AttributeKey::DSON_KEY,
            "keyvals" => proto::AttributeKey::DSON_KEYVALS,
            "label" => proto::AttributeKey::DSON_LABEL,
            "label_align" => proto::AttributeKey::DSON_LABEL_ALIGN,
            "label_anchor" => proto::AttributeKey::DSON_LABEL_ANCHOR,
            "label_angle" => proto::AttributeKey::DSON_LABEL_ANGLE,
            "label_baseline" => proto::AttributeKey::DSON_LABEL_BASELINE,
            "label_color" => proto::AttributeKey::DSON_LABEL_COLOR,
            "label_expr" => proto::AttributeKey::DSON_LABEL_EXPR,
            "label_font" => proto::AttributeKey::DSON_LABEL_FONT,
            "label_font_size" => proto::AttributeKey::DSON_LABEL_FONT_SIZE,
            "label_font_weight" => proto::AttributeKey::DSON_LABEL_FONT_WEIGHT,
            "label_limit" => proto::AttributeKey::DSON_LABEL_LIMIT,
            "label_line_height" => proto::AttributeKey::DSON_LABEL_LINE_HEIGHT,
            "label_orient" => proto::AttributeKey::DSON_LABEL_ORIENT,
            "label_overlap" => proto::AttributeKey::DSON_LABEL_OVERLAP,
            "label_padding" => proto::AttributeKey::DSON_LABEL_PADDING,
            "latitude" => proto::AttributeKey::DSON_LATITUDE,
            "layer" => proto::AttributeKey::DSON_LAYER,
            "legend" => proto::AttributeKey::DSON_LEGEND,
            "limit" => proto::AttributeKey::DSON_LIMIT,
            "line" => proto::AttributeKey::DSON_LINE,
            "line_height" => proto::AttributeKey::DSON_LINE_HEIGHT,
            "loess" => proto::AttributeKey::DSON_LOESS,
            "longitude" => proto::AttributeKey::DSON_LONGITUDE,
            "mark" => proto::AttributeKey::DSON_MARK,
            "max_band_size" => proto::AttributeKey::DSON_MAX_BAND_SIZE,
            "max_extent" => proto::AttributeKey::DSON_MAX_EXTENT,
            "max_font_size" => proto::AttributeKey::DSON_MAX_FONT_SIZE,
            "max_opacity" => proto::AttributeKey::DSON_MAX_OPACITY,
            "max_size" => proto::AttributeKey::DSON_MAX_SIZE,
            "max_stroke_width" => proto::AttributeKey::DSON_MAX_STROKE_WIDTH,
            "maxbins" => proto::AttributeKey::DSON_MAXBINS,
            "mesh" => proto::AttributeKey::DSON_MESH,
            "method" => proto::AttributeKey::DSON_METHOD,
            "min_band_size" => proto::AttributeKey::DSON_MIN_BAND_SIZE,
            "min_extent" => proto::AttributeKey::DSON_MIN_EXTENT,
            "min_font_size" => proto::AttributeKey::DSON_MIN_FONT_SIZE,
            "min_opacity" => proto::AttributeKey::DSON_MIN_OPACITY,
            "min_size" => proto::AttributeKey::DSON_MIN_SIZE,
            "min_stroke_width" => proto::AttributeKey::DSON_MIN_STROKE_WIDTH,
            "minstep" => proto::AttributeKey::DSON_MINSTEP,
            "nice" => proto::AttributeKey::DSON_NICE,
            "not" => proto::AttributeKey::DSON_NOT,
            "offset" => proto::AttributeKey::DSON_OFFSET,
            "on" => proto::AttributeKey::DSON_ON,
            "op" => proto::AttributeKey::DSON_OP,
            "opacity" => proto::AttributeKey::DSON_OPACITY,
            "ordinal" => proto::AttributeKey::DSON_ORDINAL,
            "orient" => proto::AttributeKey::DSON_ORIENT,
            "outer_radius" => proto::AttributeKey::DSON_OUTER_RADIUS,
            "pad_angle" => proto::AttributeKey::DSON_PAD_ANGLE,
            "padding" => proto::AttributeKey::DSON_PADDING,
            "padding_inner" => proto::AttributeKey::DSON_PADDING_INNER,
            "padding_outer" => proto::AttributeKey::DSON_PADDING_OUTER,
            "param" => proto::AttributeKey::DSON_PARAM,
            "params" => proto::AttributeKey::DSON_PARAMS,
            "parse" => proto::AttributeKey::DSON_PARSE,
            "pivot" => proto::AttributeKey::DSON_PIVOT,
            "point" => proto::AttributeKey::DSON_POINT,
            "point_padding" => proto::AttributeKey::DSON_POINT_PADDING,
            "position" => proto::AttributeKey::DSON_POSITION,
            "precision" => proto::AttributeKey::DSON_EXTENT_PRECISION,
            "prob" => proto::AttributeKey::DSON_PROB,
            "probs" => proto::AttributeKey::DSON_PROBS,
            "projection" => proto::AttributeKey::DSON_PROJECTION,
            "quantile" => proto::AttributeKey::DSON_QUANTILE,
            "radius" => proto::AttributeKey::DSON_RADIUS,
            "radius2" => proto::AttributeKey::DSON_RADIUS2,
            "radius2_offset" => proto::AttributeKey::DSON_RADIUS2_OFFSET,
            "radius_offset" => proto::AttributeKey::DSON_RADIUS_OFFSET,
            "ramp" => proto::AttributeKey::DSON_RAMP,
            "range" => proto::AttributeKey::DSON_RANGE,
            "range_max" => proto::AttributeKey::DSON_RANGE_MAX,
            "range_min" => proto::AttributeKey::DSON_RANGE_MIN,
            "rect" => proto::AttributeKey::DSON_RECT,
            "rect_band_padding_inner" => proto::AttributeKey::DSON_RECT_BAND_PADDING_INNER,
            "reverse" => proto::AttributeKey::DSON_REVERSE,
            "round" => proto::AttributeKey::DSON_ROUND,
            "row" => proto::AttributeKey::DSON_ROW,
            "row_padding" => proto::AttributeKey::DSON_ROW_PADDING,
            "scale" => proto::AttributeKey::DSON_SCALE,
            "schema" => proto::AttributeKey::DSON_SCHEMA,
            "shape" => proto::AttributeKey::DSON_SHAPE,
            "size" => proto::AttributeKey::DSON_SIZE,
            "spacing" => proto::AttributeKey::DSON_SPACING,
            "stack" => proto::AttributeKey::DSON_STACK,
            "stacked" => proto::AttributeKey::DSON_STACKED,
            "start" => proto::AttributeKey::DSON_START,
            "step" => proto::AttributeKey::DSON_STROKE_STEP,
            "step_major" => proto::AttributeKey::DSON_STEP_MAJOR,
            "step_minor" => proto::AttributeKey::DSON_STEP_MINOR,
            "steps" => proto::AttributeKey::DSON_STEPS,
            "stop" => proto::AttributeKey::DSON_STOP,
            "stroke" => proto::AttributeKey::DSON_STROKE,
            "stroke_cap" => proto::AttributeKey::DSON_STROKE_CAP,
            "stroke_dash" => proto::AttributeKey::DSON_STROKE_DASH,
            "stroke_dash_offset" => proto::AttributeKey::DSON_STROKE_DASH_OFFSET,
            "stroke_join" => proto::AttributeKey::DSON_STROKE_JOIN,
            "stroke_miter_limit" => proto::AttributeKey::DSON_STROKE_MITER_LIMIT,
            "stroke_opacity" => proto::AttributeKey::DSON_STROKE_OPACITY,
            "stroke_width" => proto::AttributeKey::DSON_STROKE_WIDTH,
            "style" => proto::AttributeKey::DSON_STYLE,
            "subtitle" => proto::AttributeKey::DSON_SUBTITLE,
            "subtitle_color" => proto::AttributeKey::DSON_SUBTITLE_COLOR,
            "subtitle_font" => proto::AttributeKey::DSON_SUBTITLE_FONT,
            "subtitle_font_size" => proto::AttributeKey::DSON_SUBTITLE_FONT_SIZE,
            "subtitle_font_style" => proto::AttributeKey::DSON_SUBTITLE_FONT_STYLE,
            "subtitle_font_weight" => proto::AttributeKey::DSON_SUBTITLE_FONT_WEIGHT,
            "subtitle_line_height" => proto::AttributeKey::DSON_SUBTITLE_LINE_HEIGHT,
            "subtitle_padding" => proto::AttributeKey::DSON_SUBTITLE_PADDING,
            "symbol" => proto::AttributeKey::DSON_SYMBOL,
            "symbol_base_fill_color" => proto::AttributeKey::DSON_SYMBOL_BASE_FILL_COLOR,
            "symbol_base_stroke_color" => proto::AttributeKey::DSON_SYMBOL_BASE_STROKE_COLOR,
            "symbol_dash" => proto::AttributeKey::DSON_SYMBOL_DASH,
            "symbol_dash_offset" => proto::AttributeKey::DSON_SYMBOL_DASH_OFFSET,
            "symbol_direction" => proto::AttributeKey::DSON_SYMBOL_DIRECTION,
            "symbol_fill_color" => proto::AttributeKey::DSON_SYMBOL_FILL_COLOR,
            "symbol_limit" => proto::AttributeKey::DSON_SYMBOL_LIMIT,
            "symbol_offset" => proto::AttributeKey::DSON_SYMBOL_OFFSET,
            "symbol_opacity" => proto::AttributeKey::DSON_SYMBOL_OPACITY,
            "symbol_size" => proto::AttributeKey::DSON_SYMBOL_SIZE,
            "symbol_stroke_color" => proto::AttributeKey::DSON_SYMBOL_STROKE_COLOR,
            "symbol_stroke_width" => proto::AttributeKey::DSON_SYMBOL_STROKE_WIDTH,
            "symbol_type" => proto::AttributeKey::DSON_SYMBOL_TYPE,
            "tension" => proto::AttributeKey::DSON_TENSION,
            "test" => proto::AttributeKey::DSON_TEST,
            "text" => proto::AttributeKey::DSON_TEXT,
            "theta" => proto::AttributeKey::DSON_THETA,
            "theta2" => proto::AttributeKey::DSON_THETA2,
            "theta2_offset" => proto::AttributeKey::DSON_THETA2_OFFSET,
            "theta_offset" => proto::AttributeKey::DSON_THETA_OFFSET,
            "thickness" => proto::AttributeKey::DSON_TICKNESS,
            "tick_band" => proto::AttributeKey::DSON_TICK_BAND,
            "tick_count" => proto::AttributeKey::DSON_TICK_COUNT,
            "tick_extra" => proto::AttributeKey::DSON_TICK_EXTRA,
            "tick_min_step" => proto::AttributeKey::DSON_TICK_MIN_STEP,
            "tick_offset" => proto::AttributeKey::DSON_TICK_OFFSET,
            "tick_opacity" => proto::AttributeKey::DSON_TICK_OPACITY,
            "tick_size" => proto::AttributeKey::DSON_TICK_SIZE,
            "time_unit" => proto::AttributeKey::DSON_TIME_UNIT,
            "title" => proto::AttributeKey::DSON_TITLE,
            "tooltip" => proto::AttributeKey::DSON_TOOLTIP,
            "trail" => proto::AttributeKey::DSON_TRAIL,
            "translate" => proto::AttributeKey::DSON_TRANSLATE,
            "type" => proto::AttributeKey::DSON_TYPE,
            "unselected_opacity" => proto::AttributeKey::DSON_UNSELECTED_OPACITY,
            "url" => proto::AttributeKey::DSON_URL,
            "use_unaggregated_domain" => proto::AttributeKey::DSON_USE_UNAGGREGATED_DOMAIN,
            "usermeta" => proto::AttributeKey::DSON_USERMETA,
            "value" => proto::AttributeKey::DSON_VALUE,
            "view" => proto::AttributeKey::DSON_VIEW,
            "width" => proto::AttributeKey::DSON_WIDTH,
            "x" => proto::AttributeKey::DSON_X,
            "x2" => proto::AttributeKey::DSON_X2,
            "x2_offset" => proto::AttributeKey::DSON_X2_OFFSET,
            "x_offset" => proto::AttributeKey::DSON_X_OFFSET,
            "x_reverse" => proto::AttributeKey::DSON_X_REVERSE,
            "y" => proto::AttributeKey::DSON_Y,
            "y2" => proto::AttributeKey::DSON_Y2,
            "y2_offset" => proto::AttributeKey::DSON_Y2_OFFSET,
            "y_offset" => proto::AttributeKey::DSON_Y_OFFSET,
            "zero" => proto::AttributeKey::DSON_ZERO,
            "zindex" => proto::AttributeKey::DSON_ZINDEX,
            _ => proto::AttributeKey::NONE,
        };
        if known != proto::AttributeKey::NONE {
            DsonKey::Known(known)
        } else {
            DsonKey::Unknown(arena.alloc_str(s))
        }
    }
}

#[derive(Debug, Clone, Hash, PartialEq, Default, Eq)]
pub struct DsonField<'arena> {
    pub key: DsonKey<'arena>,
    pub value: DsonValue<'arena>,
}

#[derive(Debug, Copy, Clone, Hash, PartialEq, Eq)]
pub enum DsonValue<'arena> {
    Object(&'arena [DsonField<'arena>]),
    Array(&'arena [DsonValue<'arena>]),
    Expression(Expression<'arena>),
}

impl<'arena> Default for DsonValue<'arena> {
    fn default() -> Self {
        DsonValue::Expression(Expression::Null)
    }
}

impl<'arena> Serialize for DsonValue<'arena> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        match &self {
            DsonValue::Object(fields) => {
                let mut m = serializer.serialize_map(Some(fields.len()))?;
                for field in fields.iter() {
                    m.serialize_entry(field.key.as_str(), &field.value)?;
                }
                m.end()
            }
            DsonValue::Array(a) => a.serialize(serializer),
            DsonValue::Expression(e) => e.serialize(serializer),
        }
    }
}

impl<'arena> DsonValue<'arena> {
    pub fn len(&self) -> usize {
        match self {
            DsonValue::Object(fields) => fields.len(),
            DsonValue::Array(elems) => elems.len(),
            DsonValue::Expression(_) => 0,
        }
    }

    pub fn is_object(&self) -> bool {
        match self {
            DsonValue::Object(_) => true,
            _ => false,
        }
    }
    pub fn is_array(&self) -> bool {
        match self {
            DsonValue::Array(_) => true,
            _ => false,
        }
    }
    pub fn is_expression(&self) -> bool {
        match self {
            DsonValue::Expression(_) => true,
            _ => false,
        }
    }

    pub fn as_object(&self) -> &'arena [DsonField<'arena>] {
        match self {
            DsonValue::Object(fields) => fields,
            DsonValue::Array(_) => &[],
            DsonValue::Expression(_) => &[],
        }
    }
    pub fn as_array(&self) -> &'arena [DsonValue<'arena>] {
        match self {
            DsonValue::Object(_) => &[],
            DsonValue::Array(values) => values,
            DsonValue::Expression(_) => &[],
        }
    }
    pub fn as_expression(&self) -> Expression<'arena> {
        match self {
            DsonValue::Object(_) => Expression::Null,
            DsonValue::Array(_) => Expression::Null,
            DsonValue::Expression(e) => e.clone(),
        }
    }

    pub fn as_json<'snap>(
        &self,
        ctx: &mut ExecutionContextSnapshot<'arena, 'snap>,
    ) -> Result<serde_json::value::Value, SystemError> {
        match &self {
            DsonValue::Object(fields) => {
                let mut obj = serde_json::Map::with_capacity(fields.len());
                for field in fields.iter() {
                    let key = field.key.as_str().to_string();
                    let value = field.value.as_json(ctx)?;
                    obj.insert(key, value);
                }
                Ok(serde_json::value::Value::Object(obj))
            }
            DsonValue::Array(elements) => {
                let mut values = Vec::with_capacity(elements.len());
                for elem in elements.iter() {
                    values.push(elem.as_json(ctx)?)
                }
                Ok(serde_json::value::Value::Array(values))
            }
            DsonValue::Expression(expr) => {
                let value = evaluate_constant_expression(expr.clone(), ctx)?;
                match value {
                    Some(v) => Ok(scalar_to_json(&v)),
                    None => Ok(serde_json::value::Value::Null),
                }
            }
        }
    }

    pub fn from_json(arena: &'arena bumpalo::Bump, value: &sj::value::Value) -> Self {
        match value {
            sj::Value::Null => DsonValue::Expression(Expression::Null),
            sj::Value::Bool(v) => DsonValue::Expression(Expression::Boolean(*v)),
            sj::Value::Number(v) => {
                let v = arena.alloc_str(&v.to_string());
                DsonValue::Expression(Expression::LiteralFloat(v))
            }
            sj::Value::String(v) => {
                let v = arena.alloc_str(&v);
                DsonValue::Expression(Expression::LiteralString(v))
            }
            sj::Value::Array(vs) => {
                let vs: Vec<_> = vs.iter().map(|v| DsonValue::from_json(arena, v)).collect();
                DsonValue::Array(arena.alloc_slice_clone(&vs))
            }
            sj::Value::Object(fields) => {
                let mut attrs = Vec::new();
                for (key, value) in fields.iter() {
                    attrs.push(DsonField {
                        key: DsonKey::from_str(key, arena),
                        value: DsonValue::from_json(arena, value),
                    });
                }
                let attrs = arena.alloc_slice_clone(&attrs);
                DsonValue::Object(attrs)
            }
        }
    }
}

pub trait DsonAccess<Idx>
where
    Idx: Sized,
{
    type Output: Sized;
    fn get(&self, index: Idx) -> Option<Self::Output>;
}

impl<'arena> DsonAccess<usize> for DsonValue<'arena> {
    type Output = &'arena DsonValue<'arena>;
    fn get(&self, index: usize) -> Option<Self::Output> {
        match self {
            DsonValue::Expression(_) | DsonValue::Object(_) => None,
            DsonValue::Array(a) => Some(&a[index]),
        }
    }
}

impl<'arena> DsonAccess<proto::AttributeKey> for DsonValue<'arena> {
    type Output = &'arena DsonValue<'arena>;
    fn get(&self, index: proto::AttributeKey) -> Option<Self::Output> {
        match self {
            DsonValue::Object(o) => o
                .binary_search_by(|f| match f.key {
                    DsonKey::Known(probe) => probe.cmp(&index),
                    DsonKey::Unknown(_) => std::cmp::Ordering::Greater,
                })
                .ok()
                .map(|idx| &o[idx].value),
            DsonValue::Expression(_) | DsonValue::Array(_) => None,
        }
    }
}

impl<'arena> DsonAccess<&str> for DsonValue<'arena> {
    type Output = &'arena DsonValue<'arena>;

    fn get(&self, index: &str) -> Option<Self::Output> {
        match self {
            DsonValue::Object(o) => o
                .iter()
                .find(|f| match f.key {
                    DsonKey::Known(probe) => probe.variant_name().unwrap_or_default() == index,
                    DsonKey::Unknown(probe) => probe == index,
                })
                .map(|f| &f.value),
            DsonValue::Expression(_) | DsonValue::Array(_) => None,
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::{
        execution::{execution_context::ExecutionContext, scalar_value::ScalarValue},
        external::parser::parse_into,
        grammar::{self, ASTCell, Statement},
    };
    use std::collections::HashMap;
    use std::error::Error;
    use std::rc::Rc;

    #[tokio::test]
    async fn test_set() -> Result<(), Box<dyn Error + Send + Sync>> {
        let text = r#"
            set 'key' = 42;
        "#;
        let arena = bumpalo::Bump::new();
        let (ast, ast_data) = parse_into(&arena, text).await?;
        let prog = grammar::deserialize_ast(&arena, text, ast, ast_data).unwrap();
        assert_eq!(prog.statements.len(), 1);

        let stmt = match &prog.statements[0] {
            Statement::Set(set) => set,
            _ => panic!("unexpected statement: {:?}", &prog.statements[0]),
        };
        match stmt.fields.get().get("key") {
            Some(DsonValue::Expression(Expression::LiteralInteger(s))) => {
                assert_eq!(s.clone(), "42");
            }
            _ => panic!("unexpected dson value: {:?}", stmt.fields),
        };
        Ok(())
    }

    async fn test_json<'a>(
        arena: &'a bumpalo::Bump,
        dson: DsonValue<'a>,
        json: &'static str,
    ) -> Result<(), SystemError> {
        let ctx = ExecutionContext::create_simple(&arena).await?;
        let mut ctx_snap = ctx.snapshot();
        let value = dson.as_json(&mut ctx_snap)?;
        let value_text = value.to_string();
        assert_eq!(value_text, json);
        Ok(())
    }

    async fn test_json_with_values<'a>(
        arena: &'a bumpalo::Bump,
        dson: DsonValue<'a>,
        json: &'static str,
        named_values: HashMap<NamePath<'a>, Option<Rc<ScalarValue>>>,
    ) -> Result<(), SystemError> {
        let ctx = ExecutionContext::create_simple(&arena).await?;
        let mut ctx_snap = ctx.snapshot();
        ctx_snap.local_state.parameters = named_values;
        let value = dson.as_json(&mut ctx_snap)?;
        let value_text = value.to_string();
        assert_eq!(value_text, json);
        Ok(())
    }

    #[tokio::test]
    async fn test_as_json_simple() -> Result<(), Box<dyn Error + Send + Sync>> {
        let arena = bumpalo::Bump::new();
        test_json(&arena, DsonValue::Expression(Expression::Boolean(true)), "true").await?;
        test_json(&arena, DsonValue::Expression(Expression::Boolean(false)), "false").await?;
        test_json(
            &arena,
            DsonValue::Expression(Expression::LiteralString("foo")),
            "\"foo\"",
        )
        .await?;
        test_json(&arena, DsonValue::Expression(Expression::LiteralString("")), "\"\"").await?;
        test_json(&arena, DsonValue::Expression(Expression::LiteralInteger("0")), "0").await?;
        test_json(&arena, DsonValue::Expression(Expression::LiteralInteger("42")), "42").await?;
        test_json(&arena, DsonValue::Expression(Expression::LiteralFloat("42")), "42.0").await?;
        test_json(
            &arena,
            DsonValue::Array(&[
                DsonValue::Expression(Expression::Boolean(true)),
                DsonValue::Expression(Expression::Boolean(false)),
            ]),
            "[true,false]",
        )
        .await?;
        test_json(
            &arena,
            DsonValue::Object(&[DsonField {
                key: DsonKey::Known(proto::AttributeKey::DSON_FILL),
                value: DsonValue::Expression(Expression::Boolean(true)),
            }]),
            r#"{"fill":true}"#,
        )
        .await?;
        test_json(
            &arena,
            DsonValue::Object(&[
                DsonField {
                    key: DsonKey::Known(proto::AttributeKey::DSON_FILL),
                    value: DsonValue::Expression(Expression::Boolean(true)),
                },
                DsonField {
                    key: DsonKey::Unknown("foo"),
                    value: DsonValue::Expression(Expression::LiteralString("bar")),
                },
            ]),
            r#"{"fill":true,"foo":"bar"}"#,
        )
        .await?;
        Ok(())
    }

    #[tokio::test]
    async fn test_parameter_ref() -> Result<(), Box<dyn Error + Send + Sync>> {
        let arena = bumpalo::Bump::new();
        test_json_with_values(
            &arena,
            DsonValue::Expression(Expression::ParameterRef(&ParameterRef {
                name: ASTCell::with_value(&[ASTCell::with_value(Indirection::Name("foo"))]),
            })),
            "42",
            HashMap::from([(
                [ASTCell::with_value(Indirection::Name("foo"))].as_slice(),
                Some(Rc::new(ScalarValue::Int64(42))),
            )]),
        )
        .await?;
        Ok(())
    }

    #[tokio::test]
    async fn test_missing_function() -> Result<(), Box<dyn Error + Send + Sync>> {
        let arena = bumpalo::Bump::new();
        let res = test_json(
            &arena,
            DsonValue::Expression(Expression::FunctionCall(&FunctionExpression {
                name: ASTCell::with_value(FunctionName::Unknown("notexisting")),
                ..FunctionExpression::default()
            })),
            r#""42""#,
        )
        .await;
        assert!(res.is_err());
        let err = res.err().unwrap();
        assert_eq!(err.to_string(), "function not implemented: notexisting");
        Ok(())
    }

    #[tokio::test]
    async fn test_format_function() -> Result<(), Box<dyn Error + Send + Sync>> {
        let arena = bumpalo::Bump::new();
        test_json(
            &arena,
            DsonValue::Expression(Expression::FunctionCall(&FunctionExpression {
                name: FunctionName::Unknown("format").into(),
                args: ASTCell::with_value(&[
                    ASTCell::with_value(&FunctionArgument {
                        name: None.into(),
                        value: Expression::LiteralString(r#"{}"#).into(),
                    }),
                    ASTCell::with_value(&FunctionArgument {
                        name: None.into(),
                        value: Expression::LiteralInteger("42").into(),
                    }),
                ]),
                ..FunctionExpression::default()
            })),
            r#""42""#,
        )
        .await?;
        test_json(
            &arena,
            DsonValue::Object(&[DsonField {
                key: DsonKey::Known(proto::AttributeKey::DSON_URL),
                value: DsonValue::Expression(Expression::FunctionCall(&FunctionExpression {
                    name: FunctionName::Unknown("format").into(),
                    args: ASTCell::with_value(&[
                        ASTCell::with_value(&FunctionArgument {
                            name: None.into(),
                            value: Expression::LiteralString(r#"{}"#).into(),
                        }),
                        ASTCell::with_value(&FunctionArgument {
                            name: None.into(),
                            value: Expression::LiteralInteger("42").into(),
                        }),
                    ]),
                    ..FunctionExpression::default()
                })),
            }]),
            r#"{"url":"42"}"#,
        )
        .await?;
        Ok(())
    }
}

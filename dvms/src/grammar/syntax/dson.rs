use crate::execution::{
    constant_folding::evaluate_constant_expression, expression_evaluator::ExpressionEvaluationContext,
    scalar_value::scalar_to_json,
};

use super::ast_nodes_sql::*;
use dashql_proto::syntax as sx;
use serde::{ser::SerializeMap, Serialize};
use std::error::Error;

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub enum DsonKey<'arena> {
    Known(sx::AttributeKey),
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
                sx::AttributeKey::DSON_AGGREGATE => "aggregate",
                sx::AttributeKey::DSON_ALIGN => "align",
                sx::AttributeKey::DSON_ANCHOR => "anchor",
                sx::AttributeKey::DSON_ANGLE => "angle",
                sx::AttributeKey::DSON_ARC => "arc",
                sx::AttributeKey::DSON_ARIA => "aria",
                sx::AttributeKey::DSON_AS => "as",
                sx::AttributeKey::DSON_AXIS => "axis",
                sx::AttributeKey::DSON_BAND_PADDING_INNER => "band_padding_inner",
                sx::AttributeKey::DSON_BAND_PADDING_OUTER => "band_padding_outer",
                sx::AttributeKey::DSON_BAND_POSITION => "band_position",
                sx::AttributeKey::DSON_BANDWIDTH => "bandwidth",
                sx::AttributeKey::DSON_BAR_BAND_PADDING_INNER => "bar_band_padding_inner",
                sx::AttributeKey::DSON_BASELINE => "baseline",
                sx::AttributeKey::DSON_BIN => "bin",
                sx::AttributeKey::DSON_BIN_SPACING => "bin_spacing",
                sx::AttributeKey::DSON_BINNED => "binned",
                sx::AttributeKey::DSON_BLEND => "blend",
                sx::AttributeKey::DSON_BORDERS => "borders",
                sx::AttributeKey::DSON_BOUNDS => "bounds",
                sx::AttributeKey::DSON_CATEGORY => "category",
                sx::AttributeKey::DSON_CENTER => "center",
                sx::AttributeKey::DSON_CIRCLE => "circle",
                sx::AttributeKey::DSON_CLAMP => "clamp",
                sx::AttributeKey::DSON_CLIP => "clip",
                sx::AttributeKey::DSON_CLIP_HEIGHT => "clip_height",
                sx::AttributeKey::DSON_COLOR => "color",
                sx::AttributeKey::DSON_COLUMN => "column",
                sx::AttributeKey::DSON_COLUMN_PADDING => "column_padding",
                sx::AttributeKey::DSON_CONDITION => "condition",
                sx::AttributeKey::DSON_CONFIG => "config",
                sx::AttributeKey::DSON_CONSTANT => "constant",
                sx::AttributeKey::DSON_CONTINUOUS_BAND_SIZE => "continuous_band_size",
                sx::AttributeKey::DSON_CONTINUOUS_PADDING => "continuous_padding",
                sx::AttributeKey::DSON_CORNER_RADIUS => "corner_radius",
                sx::AttributeKey::DSON_CORNER_RADIUS_BOTTOM_LEFT => "corner_radius_bottom_left",
                sx::AttributeKey::DSON_CORNER_RADIUS_BOTTOM_RIGHT => "corner_radius_bottom_right",
                sx::AttributeKey::DSON_CORNER_RADIUS_END => "corner_radius_end",
                sx::AttributeKey::DSON_CORNER_RADIUS_TOP_LEFT => "corner_radius_top_left",
                sx::AttributeKey::DSON_CORNER_RADIUS_TOP_RIGHT => "corner_radius_top_right",
                sx::AttributeKey::DSON_COUNT => "count",
                sx::AttributeKey::DSON_CUMULATIVE => "cumulative",
                sx::AttributeKey::DSON_CURSOR => "cursor",
                sx::AttributeKey::DSON_DASHQL => "dashql",
                sx::AttributeKey::DSON_DATA => "data",
                sx::AttributeKey::DSON_DATUM => "datum",
                sx::AttributeKey::DSON_DEFAULT => "default",
                sx::AttributeKey::DSON_DELIMITER => "delimiter",
                sx::AttributeKey::DSON_DENSITY => "density",
                sx::AttributeKey::DSON_DESCRIPTION => "description",
                sx::AttributeKey::DSON_DETAIL => "detail",
                sx::AttributeKey::DSON_DIR => "dir",
                sx::AttributeKey::DSON_DISCRETE_BAND_SIZE => "discrete_band_size",
                sx::AttributeKey::DSON_DIVERGING => "diverging",
                sx::AttributeKey::DSON_DIVIDE => "divide",
                sx::AttributeKey::DSON_DOMAIN => "domain",
                sx::AttributeKey::DSON_DOMAIN_MAX => "domain_max",
                sx::AttributeKey::DSON_DOMAIN_MID => "domain_mid",
                sx::AttributeKey::DSON_DOMAIN_MIN => "domain_min",
                sx::AttributeKey::DSON_DX => "dx",
                sx::AttributeKey::DSON_DY => "dy",
                sx::AttributeKey::DSON_ELLIPSIS => "ellipsis",
                sx::AttributeKey::DSON_ENCODING => "encoding",
                sx::AttributeKey::DSON_ERRORBAND => "errorband",
                sx::AttributeKey::DSON_EXPRESSION => "expression",
                sx::AttributeKey::DSON_EXTENT => "extent",
                sx::AttributeKey::DSON_EXTENT_MAJOR => "extent_major",
                sx::AttributeKey::DSON_EXTENT_MINOR => "extent_minor",
                sx::AttributeKey::DSON_FEATURE => "feature",
                sx::AttributeKey::DSON_FIELD => "field",
                sx::AttributeKey::DSON_FIELDS => "fields",
                sx::AttributeKey::DSON_FILL => "fill",
                sx::AttributeKey::DSON_FILL_OPACITY => "fill_opacity",
                sx::AttributeKey::DSON_FILLED => "filled",
                sx::AttributeKey::DSON_FILTER => "filter",
                sx::AttributeKey::DSON_FOLD => "fold",
                sx::AttributeKey::DSON_FONT => "font",
                sx::AttributeKey::DSON_FONT_SIZE => "font_size",
                sx::AttributeKey::DSON_FONT_STYLE => "font_style",
                sx::AttributeKey::DSON_FONT_WEIGHT => "font_weight",
                sx::AttributeKey::DSON_FORMAT => "format",
                sx::AttributeKey::DSON_FORMAT_TYPE => "format_type",
                sx::AttributeKey::DSON_FRAME => "frame",
                sx::AttributeKey::DSON_GEOSHAPE => "geoshape",
                sx::AttributeKey::DSON_GRADIENT => "gradient",
                sx::AttributeKey::DSON_GRADIENT_DIRECTION => "gradient_direction",
                sx::AttributeKey::DSON_GRADIENT_HORIZONTAL_MAX_LENGTH => "gradient_horizontal_max_length",
                sx::AttributeKey::DSON_GRADIENT_HORIZONTAL_MIN_LENGTH => "gradient_horizontal_min_length",
                sx::AttributeKey::DSON_GRADIENT_LABEL_LIMIT => "gradient_label_limit",
                sx::AttributeKey::DSON_GRADIENT_LABEL_OFFSET => "gradient_label_offset",
                sx::AttributeKey::DSON_GRADIENT_LENGTH => "gradient_length",
                sx::AttributeKey::DSON_GRADIENT_OPACITY => "gradient_opacity",
                sx::AttributeKey::DSON_GRADIENT_STROKE_COLOR => "gradient_stroke_color",
                sx::AttributeKey::DSON_GRADIENT_STROKE_THICKNESS => "gradient_stroke_thickness",
                sx::AttributeKey::DSON_GRADIENT_STROKE_WIDTH => "gradient_stroke_width",
                sx::AttributeKey::DSON_GRADIENT_VERTICAL_MAX_LENGTH => "gradient_vertical_max_length",
                sx::AttributeKey::DSON_GRADIENT_VERTICAL_MIN_LENGTH => "gradient_vertical_min_length",
                sx::AttributeKey::DSON_GRATICULE => "graticule",
                sx::AttributeKey::DSON_GRID => "grid",
                sx::AttributeKey::DSON_GRID_ALIGN => "grid_align",
                sx::AttributeKey::DSON_GROUPBY => "groupby",
                sx::AttributeKey::DSON_HEADER => "header",
                sx::AttributeKey::DSON_HEATMAP => "heatmap",
                sx::AttributeKey::DSON_HEIGHT => "height",
                sx::AttributeKey::DSON_HREF => "href",
                sx::AttributeKey::DSON_IGNORE_PEERS => "ignore_peers",
                sx::AttributeKey::DSON_INNER_RADIUS => "inner_radius",
                sx::AttributeKey::DSON_INTERPOLATE => "interpolate",
                sx::AttributeKey::DSON_INVALID => "invalid",
                sx::AttributeKey::DSON_JOINAGGREGATE => "joinaggregate",
                sx::AttributeKey::DSON_KEY => "key",
                sx::AttributeKey::DSON_KEYVALS => "keyvals",
                sx::AttributeKey::DSON_LABEL => "label",
                sx::AttributeKey::DSON_LABEL_ALIGN => "label_align",
                sx::AttributeKey::DSON_LABEL_ANCHOR => "label_anchor",
                sx::AttributeKey::DSON_LABEL_ANGLE => "label_angle",
                sx::AttributeKey::DSON_LABEL_BASELINE => "label_baseline",
                sx::AttributeKey::DSON_LABEL_COLOR => "label_color",
                sx::AttributeKey::DSON_LABEL_EXPR => "label_expr",
                sx::AttributeKey::DSON_LABEL_FONT => "label_font",
                sx::AttributeKey::DSON_LABEL_FONT_SIZE => "label_font_size",
                sx::AttributeKey::DSON_LABEL_FONT_WEIGHT => "label_font_weight",
                sx::AttributeKey::DSON_LABEL_LIMIT => "label_limit",
                sx::AttributeKey::DSON_LABEL_LINE_HEIGHT => "label_line_height",
                sx::AttributeKey::DSON_LABEL_ORIENT => "label_orient",
                sx::AttributeKey::DSON_LABEL_OVERLAP => "label_overlap",
                sx::AttributeKey::DSON_LABEL_PADDING => "label_padding",
                sx::AttributeKey::DSON_LATITUDE => "latitude",
                sx::AttributeKey::DSON_LAYER => "layer",
                sx::AttributeKey::DSON_LEGEND => "legend",
                sx::AttributeKey::DSON_LIMIT => "limit",
                sx::AttributeKey::DSON_LINE => "line",
                sx::AttributeKey::DSON_LINE_HEIGHT => "line_height",
                sx::AttributeKey::DSON_LOESS => "loess",
                sx::AttributeKey::DSON_LONGITUDE => "longitude",
                sx::AttributeKey::DSON_MARK => "mark",
                sx::AttributeKey::DSON_MAX_BAND_SIZE => "max_band_size",
                sx::AttributeKey::DSON_MAX_EXTENT => "max_extent",
                sx::AttributeKey::DSON_MAX_FONT_SIZE => "max_font_size",
                sx::AttributeKey::DSON_MAX_OPACITY => "max_opacity",
                sx::AttributeKey::DSON_MAX_SIZE => "max_size",
                sx::AttributeKey::DSON_MAX_STROKE_WIDTH => "max_stroke_width",
                sx::AttributeKey::DSON_MAXBINS => "maxbins",
                sx::AttributeKey::DSON_MESH => "mesh",
                sx::AttributeKey::DSON_METHOD => "method",
                sx::AttributeKey::DSON_MIN_BAND_SIZE => "min_band_size",
                sx::AttributeKey::DSON_MIN_EXTENT => "min_extent",
                sx::AttributeKey::DSON_MIN_FONT_SIZE => "min_font_size",
                sx::AttributeKey::DSON_MIN_OPACITY => "min_opacity",
                sx::AttributeKey::DSON_MIN_SIZE => "min_size",
                sx::AttributeKey::DSON_MIN_STROKE_WIDTH => "min_stroke_width",
                sx::AttributeKey::DSON_MINSTEP => "minstep",
                sx::AttributeKey::DSON_NICE => "nice",
                sx::AttributeKey::DSON_NOT => "not",
                sx::AttributeKey::DSON_OFFSET => "offset",
                sx::AttributeKey::DSON_ON => "on",
                sx::AttributeKey::DSON_OP => "op",
                sx::AttributeKey::DSON_OPACITY => "opacity",
                sx::AttributeKey::DSON_ORDINAL => "ordinal",
                sx::AttributeKey::DSON_ORIENT => "orient",
                sx::AttributeKey::DSON_OUTER_RADIUS => "outer_radius",
                sx::AttributeKey::DSON_PAD_ANGLE => "pad_angle",
                sx::AttributeKey::DSON_PADDING => "padding",
                sx::AttributeKey::DSON_PADDING_INNER => "padding_inner",
                sx::AttributeKey::DSON_PADDING_OUTER => "padding_outer",
                sx::AttributeKey::DSON_PARAM => "param",
                sx::AttributeKey::DSON_PARAMS => "params",
                sx::AttributeKey::DSON_PARSE => "parse",
                sx::AttributeKey::DSON_PIVOT => "pivot",
                sx::AttributeKey::DSON_POINT => "point",
                sx::AttributeKey::DSON_POINT_PADDING => "point_padding",
                sx::AttributeKey::DSON_POSITION => "position",
                sx::AttributeKey::DSON_EXTENT_PRECISION => "precision",
                sx::AttributeKey::DSON_PROB => "prob",
                sx::AttributeKey::DSON_PROBS => "probs",
                sx::AttributeKey::DSON_PROJECTION => "projection",
                sx::AttributeKey::DSON_QUANTILE => "quantile",
                sx::AttributeKey::DSON_RADIUS => "radius",
                sx::AttributeKey::DSON_RADIUS2 => "radius2",
                sx::AttributeKey::DSON_RADIUS2_OFFSET => "radius2_offset",
                sx::AttributeKey::DSON_RADIUS_OFFSET => "radius_offset",
                sx::AttributeKey::DSON_RAMP => "ramp",
                sx::AttributeKey::DSON_RANGE => "range",
                sx::AttributeKey::DSON_RANGE_MAX => "range_max",
                sx::AttributeKey::DSON_RANGE_MIN => "range_min",
                sx::AttributeKey::DSON_RECT => "rect",
                sx::AttributeKey::DSON_RECT_BAND_PADDING_INNER => "rect_band_padding_inner",
                sx::AttributeKey::DSON_REVERSE => "reverse",
                sx::AttributeKey::DSON_ROUND => "round",
                sx::AttributeKey::DSON_ROW => "row",
                sx::AttributeKey::DSON_ROW_PADDING => "row_padding",
                sx::AttributeKey::DSON_SCALE => "scale",
                sx::AttributeKey::DSON_SCHEMA => "schema",
                sx::AttributeKey::DSON_SHAPE => "shape",
                sx::AttributeKey::DSON_SIZE => "size",
                sx::AttributeKey::DSON_SPACING => "spacing",
                sx::AttributeKey::DSON_STACK => "stack",
                sx::AttributeKey::DSON_START => "start",
                sx::AttributeKey::DSON_STROKE_STEP => "step",
                sx::AttributeKey::DSON_STEP_MAJOR => "step_major",
                sx::AttributeKey::DSON_STEP_MINOR => "step_minor",
                sx::AttributeKey::DSON_STEPS => "steps",
                sx::AttributeKey::DSON_STOP => "stop",
                sx::AttributeKey::DSON_STROKE => "stroke",
                sx::AttributeKey::DSON_STROKE_CAP => "stroke_cap",
                sx::AttributeKey::DSON_STROKE_DASH => "stroke_dash",
                sx::AttributeKey::DSON_STROKE_DASH_OFFSET => "stroke_dash_offset",
                sx::AttributeKey::DSON_STROKE_JOIN => "stroke_join",
                sx::AttributeKey::DSON_STROKE_MITER_LIMIT => "stroke_miter_limit",
                sx::AttributeKey::DSON_STROKE_OPACITY => "stroke_opacity",
                sx::AttributeKey::DSON_STROKE_WIDTH => "stroke_width",
                sx::AttributeKey::DSON_STYLE => "style",
                sx::AttributeKey::DSON_SUBTITLE => "subtitle",
                sx::AttributeKey::DSON_SUBTITLE_COLOR => "subtitle_color",
                sx::AttributeKey::DSON_SUBTITLE_FONT => "subtitle_font",
                sx::AttributeKey::DSON_SUBTITLE_FONT_SIZE => "subtitle_font_size",
                sx::AttributeKey::DSON_SUBTITLE_FONT_STYLE => "subtitle_font_style",
                sx::AttributeKey::DSON_SUBTITLE_FONT_WEIGHT => "subtitle_font_weight",
                sx::AttributeKey::DSON_SUBTITLE_LINE_HEIGHT => "subtitle_line_height",
                sx::AttributeKey::DSON_SUBTITLE_PADDING => "subtitle_padding",
                sx::AttributeKey::DSON_SYMBOL => "symbol",
                sx::AttributeKey::DSON_SYMBOL_BASE_FILL_COLOR => "symbol_base_fill_color",
                sx::AttributeKey::DSON_SYMBOL_BASE_STROKE_COLOR => "symbol_base_stroke_color",
                sx::AttributeKey::DSON_SYMBOL_DASH => "symbol_dash",
                sx::AttributeKey::DSON_SYMBOL_DASH_OFFSET => "symbol_dash_offset",
                sx::AttributeKey::DSON_SYMBOL_DIRECTION => "symbol_direction",
                sx::AttributeKey::DSON_SYMBOL_FILL_COLOR => "symbol_fill_color",
                sx::AttributeKey::DSON_SYMBOL_LIMIT => "symbol_limit",
                sx::AttributeKey::DSON_SYMBOL_OFFSET => "symbol_offset",
                sx::AttributeKey::DSON_SYMBOL_OPACITY => "symbol_opacity",
                sx::AttributeKey::DSON_SYMBOL_SIZE => "symbol_size",
                sx::AttributeKey::DSON_SYMBOL_STROKE_COLOR => "symbol_stroke_color",
                sx::AttributeKey::DSON_SYMBOL_STROKE_WIDTH => "symbol_stroke_width",
                sx::AttributeKey::DSON_SYMBOL_TYPE => "symbol_type",
                sx::AttributeKey::DSON_TENSION => "tension",
                sx::AttributeKey::DSON_TEST => "test",
                sx::AttributeKey::DSON_TEXT => "text",
                sx::AttributeKey::DSON_THETA => "theta",
                sx::AttributeKey::DSON_THETA2 => "theta2",
                sx::AttributeKey::DSON_THETA2_OFFSET => "theta2_offset",
                sx::AttributeKey::DSON_THETA_OFFSET => "theta_offset",
                sx::AttributeKey::DSON_TICKNESS => "thickness",
                sx::AttributeKey::DSON_TICK_BAND => "tick_band",
                sx::AttributeKey::DSON_TICK_COUNT => "tick_count",
                sx::AttributeKey::DSON_TICK_EXTRA => "tick_extra",
                sx::AttributeKey::DSON_TICK_MIN_STEP => "tick_min_step",
                sx::AttributeKey::DSON_TICK_OFFSET => "tick_offset",
                sx::AttributeKey::DSON_TICK_OPACITY => "tick_opacity",
                sx::AttributeKey::DSON_TICK_SIZE => "tick_size",
                sx::AttributeKey::DSON_TIME_UNIT => "time_unit",
                sx::AttributeKey::DSON_TITLE => "title",
                sx::AttributeKey::DSON_TOOLTIP => "tooltip",
                sx::AttributeKey::DSON_TRAIL => "trail",
                sx::AttributeKey::DSON_TRANSLATE => "translate",
                sx::AttributeKey::DSON_TYPE => "type",
                sx::AttributeKey::DSON_UNSELECTED_OPACITY => "unselected_opacity",
                sx::AttributeKey::DSON_URL => "url",
                sx::AttributeKey::DSON_USE_UNAGGREGATED_DOMAIN => "use_unaggregated_domain",
                sx::AttributeKey::DSON_USERMETA => "usermeta",
                sx::AttributeKey::DSON_VALUE => "value",
                sx::AttributeKey::DSON_VIEW => "view",
                sx::AttributeKey::DSON_WIDTH => "width",
                sx::AttributeKey::DSON_X => "x",
                sx::AttributeKey::DSON_X2 => "x2",
                sx::AttributeKey::DSON_X2_OFFSET => "x2_offset",
                sx::AttributeKey::DSON_X_OFFSET => "x_offset",
                sx::AttributeKey::DSON_X_REVERSE => "x_reverse",
                sx::AttributeKey::DSON_Y => "y",
                sx::AttributeKey::DSON_Y2 => "y2",
                sx::AttributeKey::DSON_Y2_OFFSET => "y2_offset",
                sx::AttributeKey::DSON_Y_OFFSET => "y_offset",
                sx::AttributeKey::DSON_ZERO => "zero",
                sx::AttributeKey::DSON_ZINDEX => "zindex",
                _ => todo!(),
            },
            DsonKey::Unknown(s) => s,
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

impl<'arena> Default for DsonValue<'arena> {
    fn default() -> Self {
        DsonValue::Expression(Expression::Null)
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

    pub fn as_json(
        &self,
        ctx: &mut ExpressionEvaluationContext<'arena>,
    ) -> Result<serde_json::value::Value, Box<dyn Error + Send + Sync>> {
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
                let value = evaluate_constant_expression(expr, ctx)?;
                match value {
                    Some(v) => Ok(scalar_to_json(&v)),
                    None => Ok(serde_json::value::Value::Null),
                }
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

impl<'arena> DsonAccess<sx::AttributeKey> for DsonValue<'arena> {
    type Output = &'arena DsonValue<'arena>;
    fn get(&self, index: sx::AttributeKey) -> Option<Self::Output> {
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
        execution::scalar_value::ScalarValue,
        grammar::{self, ASTCell, Statement},
    };
    use std::collections::HashMap;
    use std::error::Error;
    use std::rc::Rc;

    #[test]
    fn test_set() -> Result<(), Box<dyn Error + Send + Sync>> {
        let text = r#"
            set 'key' = 42;
        "#;
        let arena = bumpalo::Bump::new();
        let ast = grammar::parse(&arena, text)?;
        let prog = grammar::deserialize_ast(&arena, text, ast)?;
        assert_eq!(prog.statements.len(), 1);

        let stmt = match &prog.statements[0] {
            Statement::Set(set) => set,
            _ => panic!("unexpected statement: {:?}", &prog.statements[0]),
        };
        match stmt.fields.get().get("key") {
            Some(DsonValue::Expression(Expression::StringRef(s))) => {
                assert_eq!(s.clone(), "42");
            }
            _ => panic!("unexpected dson value: {:?}", stmt.fields),
        };
        Ok(())
    }

    fn test_json<'a>(dson: DsonValue<'a>, json: &'static str) -> Result<(), Box<dyn Error + Send + Sync>> {
        let mut ctx = ExpressionEvaluationContext::default();
        let value = dson.as_json(&mut ctx)?;
        let value_text = value.to_string();
        assert_eq!(value_text, json);
        Ok(())
    }

    fn test_json_with_values<'a>(
        dson: DsonValue<'a>,
        json: &'static str,
        named_values: HashMap<NamePath<'a>, Rc<ScalarValue>>,
    ) -> Result<(), Box<dyn Error + Send + Sync>> {
        let mut ctx = ExpressionEvaluationContext::default();
        ctx.named_values = named_values;
        let value = dson.as_json(&mut ctx)?;
        let value_text = value.to_string();
        assert_eq!(value_text, json);
        Ok(())
    }

    #[test]
    fn test_as_json_simple() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_json(DsonValue::Expression(Expression::Boolean(true)), "true")?;
        test_json(DsonValue::Expression(Expression::Boolean(false)), "false")?;
        test_json(DsonValue::Expression(Expression::StringRef("foo")), "\"foo\"")?;
        test_json(DsonValue::Expression(Expression::StringRef("")), "\"\"")?;
        test_json(DsonValue::Expression(Expression::Uint32(0)), "0")?;
        test_json(DsonValue::Expression(Expression::Uint32(42)), "42")?;
        test_json(
            DsonValue::Array(&[
                DsonValue::Expression(Expression::Boolean(true)),
                DsonValue::Expression(Expression::Boolean(false)),
            ]),
            "[true,false]",
        )?;
        test_json(
            DsonValue::Object(&[DsonField {
                key: DsonKey::Known(sx::AttributeKey::DSON_FILL),
                value: DsonValue::Expression(Expression::Boolean(true)),
            }]),
            r#"{"fill":true}"#,
        )?;
        test_json(
            DsonValue::Object(&[
                DsonField {
                    key: DsonKey::Known(sx::AttributeKey::DSON_FILL),
                    value: DsonValue::Expression(Expression::Boolean(true)),
                },
                DsonField {
                    key: DsonKey::Unknown("foo"),
                    value: DsonValue::Expression(Expression::StringRef("bar")),
                },
            ]),
            r#"{"fill":true,"foo":"bar"}"#,
        )?;
        Ok(())
    }

    #[test]
    fn test_column_ref() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_json_with_values(
            DsonValue::Expression(Expression::ColumnRef(&[ASTCell::with_value(Indirection::Name("foo"))])),
            "42",
            HashMap::from([(
                [ASTCell::with_value(Indirection::Name("foo"))].as_slice(),
                Rc::new(ScalarValue::Int64(42)),
            )]),
        )?;
        Ok(())
    }

    #[test]
    fn test_missing_function() -> Result<(), Box<dyn Error + Send + Sync>> {
        let res = test_json(
            DsonValue::Expression(Expression::FunctionCall(&FunctionExpression {
                name: ASTCell::with_value(FunctionName::Unknown("notexisting")),
                ..FunctionExpression::default()
            })),
            r#""42""#,
        );
        assert!(res.is_err());
        let err = res.err().unwrap();
        assert_eq!(err.to_string(), "function not implemented: notexisting");
        Ok(())
    }

    #[test]
    fn test_format_function() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_json(
            DsonValue::Expression(Expression::FunctionCall(&FunctionExpression {
                name: FunctionName::Unknown("format").into(),
                args: ASTCell::with_value(&[
                    ASTCell::with_value(&FunctionArgument {
                        name: None.into(),
                        value: Expression::StringRef(r#"{}"#).into(),
                    }),
                    ASTCell::with_value(&FunctionArgument {
                        name: None.into(),
                        value: Expression::Uint32(42).into(),
                    }),
                ]),
                ..FunctionExpression::default()
            })),
            r#""42""#,
        )?;
        test_json(
            DsonValue::Object(&[DsonField {
                key: DsonKey::Known(sx::AttributeKey::DSON_URL),
                value: DsonValue::Expression(Expression::FunctionCall(&FunctionExpression {
                    name: FunctionName::Unknown("format").into(),
                    args: ASTCell::with_value(&[
                        ASTCell::with_value(&FunctionArgument {
                            name: None.into(),
                            value: Expression::StringRef(r#"{}"#).into(),
                        }),
                        ASTCell::with_value(&FunctionArgument {
                            name: None.into(),
                            value: Expression::Uint32(42).into(),
                        }),
                    ]),
                    ..FunctionExpression::default()
                })),
            }]),
            r#"{"url":"42"}"#,
        )?;
        Ok(())
    }
}

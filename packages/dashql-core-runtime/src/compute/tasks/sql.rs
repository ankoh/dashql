//! A builder of the SQL of the computations: a chain of CTEs over a table of the compute database.
//!
//! The stages run in a fixed order, whatever the order of the calls: value ids, bins, scalar filters, semi-join
//! filters, grouping, then the final projection with its order and limit.

use crate::catalog_loader::sql::quote_identifier;
use crate::compute::types::{FilterOp, OrderByConstraint, ScalarFilter};

/// The conversion of a value into a number for binning
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ToNumeric {
    /// The seconds of a temporal value since epoch, `EXTRACT(EPOCH FROM ...)`
    Epoch,
    /// The seconds of a time of day since midnight, Hyper extracts no epoch from a time
    TimeEpoch,
    /// A boolean as 0 or 1
    Boolean,
}

impl ToNumeric {
    /// Are the values temporal?
    fn is_temporal(self) -> bool {
        matches!(self, ToNumeric::Epoch | ToNumeric::TimeEpoch)
    }
}

/// An aggregate of a grouping
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AggregateFunction {
    /// `MIN(field)`
    Min(String),
    /// `MAX(field)`
    Max(String),
    /// `AVG(field)`
    Avg(String),
    /// `COUNT(field)`
    Count(String),
    /// `COUNT(DISTINCT field)`
    CountDistinct(String),
    /// `COUNT(*)`
    CountStar,
}

/// An aggregate with its output field
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GroupByAggregate {
    /// The aggregate
    pub func: AggregateFunction,
    /// The output field
    pub output_alias: String,
}

impl GroupByAggregate {
    /// An aggregate
    pub fn new(func: AggregateFunction, output_alias: impl Into<String>) -> Self {
        Self { func, output_alias: output_alias.into() }
    }
}

/// Binned values as a field of every row
#[derive(Clone, Debug, PartialEq)]
pub struct Binning {
    /// The field to bin
    pub field_name: String,
    /// The table with the minimum and the maximum
    pub stats_table: String,
    /// The field of the minimum
    pub stats_min_field: String,
    /// The field of the maximum
    pub stats_max_field: String,
    /// The bins
    pub bin_count: u32,
    /// The smallest width of a bin, 1e-15 without
    pub min_bin_width: Option<f64>,
    /// The output field with the fractional bin
    pub output_alias: String,
    /// The conversion into a number, a cast to double without
    pub to_numeric: Option<ToNumeric>,
}

/// The binning of a key of a grouping
#[derive(Clone, Debug, PartialEq)]
pub struct GroupByKeyBinning {
    /// A field with the bins already, the key field is binned without
    pub pre_binned_field_name: Option<String>,
    /// The bins
    pub bin_count: u32,
    /// The smallest width of a bin, 1e-15 without
    pub min_bin_width: Option<f64>,
    /// The table with the minimum and the maximum
    pub stats_table: String,
    /// The field of the minimum
    pub stats_min_field: String,
    /// The field of the maximum
    pub stats_max_field: String,
    /// The output field with the lower bound of a bin
    pub output_bin_lb_alias: String,
    /// The output field with the upper bound of a bin
    pub output_bin_ub_alias: String,
    /// The output field with the width of a bin
    pub output_bin_width_alias: String,
    /// Count the nulls in a bin after the last one
    pub include_null_bin: bool,
    /// The conversion into a number, a cast to double without
    pub to_numeric: Option<ToNumeric>,
}

/// A key of a grouping
#[derive(Clone, Debug, PartialEq)]
pub struct GroupByKey {
    /// The field
    pub field_name: String,
    /// The output field
    pub output_alias: String,
    /// The binning of the field, the first binned key of a grouping is binned
    pub binning: Option<GroupByKeyBinning>,
}

impl GroupByKey {
    /// A key that isn't binned
    pub fn new(field_name: impl Into<String>, output_alias: impl Into<String>) -> Self {
        Self { field_name: field_name.into(), output_alias: output_alias.into(), binning: None }
    }
}

/// A grouping
#[derive(Clone, Debug, Default, PartialEq)]
pub struct GroupBy {
    /// The keys, a global aggregation without
    pub keys: Vec<GroupByKey>,
    /// The aggregates
    pub aggregates: Vec<GroupByAggregate>,
}

/// A filter that keeps the rows whose field is in a field of another table
#[derive(Clone, Debug, PartialEq, Eq)]
struct SemiJoinFilter {
    field_name: String,
    table_name: String,
    join_field_name: String,
}

/// Format a number the way JavaScript prints it, e.g. `10`, `10.5`, `1e-15`, `1e+21`
pub fn format_number(value: f64) -> String {
    if value.is_nan() {
        return "NaN".to_string();
    }
    if value.is_infinite() {
        return if value > 0.0 { "Infinity" } else { "-Infinity" }.to_string();
    }
    if value == 0.0 {
        return "0".to_string();
    }
    // The shortest digits that round trip, with the exponent of the first digit
    let scientific = format!("{:e}", value.abs());
    let (mantissa, exponent) = match scientific.split_once('e') {
        Some(parts) => parts,
        None => return value.to_string(),
    };
    let exponent: i64 = match exponent.parse() {
        Ok(exponent) => exponent,
        Err(_) => return value.to_string(),
    };
    let digits: String = mantissa.chars().filter(char::is_ascii_digit).collect();
    let k = digits.len() as i64;
    let n = exponent + 1;
    let sign = if value < 0.0 { "-" } else { "" };
    let body = if k <= n && n <= 21 {
        format!("{digits}{}", "0".repeat((n - k) as usize))
    } else if 0 < n && n <= 21 {
        let (int, frac) = digits.split_at(n as usize);
        format!("{int}.{frac}")
    } else if -6 < n && n <= 0 {
        format!("0.{}{digits}", "0".repeat((-n) as usize))
    } else {
        let exp_sign = if n - 1 < 0 { "-" } else { "+" };
        let (first, rest) = digits.split_at(1);
        let rest = if rest.is_empty() { String::new() } else { format!(".{rest}") };
        format!("{first}{rest}e{exp_sign}{}", (n - 1).abs())
    };
    format!("{sign}{body}")
}

fn filter_op(op: FilterOp) -> &'static str {
    match op {
        FilterOp::Equal => "=",
        FilterOp::Less => "<",
        FilterOp::LessEqual => "<=",
        FilterOp::Greater => ">",
        FilterOp::GreaterEqual => ">=",
    }
}

fn bin_width_expression(range: &str, bin_count: u32, min_bin_width: Option<f64>) -> String {
    format!("GREATEST({range} / {bin_count}, {})", format_number(min_bin_width.unwrap_or(1e-15)))
}

fn to_numeric(expr: &str, conversion: Option<ToNumeric>) -> String {
    match conversion {
        Some(ToNumeric::Epoch) => format!("EXTRACT(EPOCH FROM {expr})"),
        Some(ToNumeric::TimeEpoch) => format!("EXTRACT(EPOCH FROM CAST({expr} AS INTERVAL))"),
        Some(ToNumeric::Boolean) => format!("CASE WHEN {expr} THEN 1.0 WHEN NOT {expr} THEN 0.0 END"),
        None => format!("CAST({expr} AS DOUBLE PRECISION)"),
    }
}

fn format_aggregate(aggregate: &AggregateFunction) -> String {
    match aggregate {
        AggregateFunction::Min(field) => format!("MIN({})", quote_identifier(field)),
        AggregateFunction::Max(field) => format!("MAX({})", quote_identifier(field)),
        AggregateFunction::Avg(field) => format!("AVG({})", quote_identifier(field)),
        AggregateFunction::Count(field) => format!("COUNT({})", quote_identifier(field)),
        AggregateFunction::CountDistinct(field) => format!("COUNT(DISTINCT {})", quote_identifier(field)),
        AggregateFunction::CountStar => "COUNT(*)".to_string(),
    }
}

/// An item of an ORDER BY, ascending with nulls last by default
pub fn format_order_by_item(constraint: &OrderByConstraint) -> String {
    let direction = if constraint.ascending.unwrap_or(true) { "ASC" } else { "DESC" };
    let nulls = if constraint.nulls_first.unwrap_or(false) { "NULLS FIRST" } else { "NULLS LAST" };
    format!("{} {direction} {nulls}", quote_identifier(&constraint.field))
}

fn push_cte(ctes: &mut Vec<String>, name: &str, body: &str) {
    ctes.push(format!("{name} AS (\n    {body}\n  )"));
}

fn group_by_positions(keys: usize) -> String {
    (1..=keys).map(|position| position.to_string()).collect::<Vec<_>>().join(", ")
}

/// The SQL of a computation over a table
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SqlFrame {
    input_table: String,
    value_identifiers: Vec<(String, String)>,
    binnings: Vec<Binning>,
    scalar_filters: Vec<ScalarFilter>,
    semi_join_filters: Vec<SemiJoinFilter>,
    group_by: Option<GroupBy>,
    order_by: Option<Vec<OrderByConstraint>>,
    limit: Option<u64>,
    projection: Option<Vec<String>>,
}

impl SqlFrame {
    /// The SQL over a table
    pub fn from(input_table: impl Into<String>) -> Self {
        Self { input_table: input_table.into(), ..Default::default() }
    }

    /// Number the distinct values of a field, by `dense_rank()` in ascending order with nulls last
    pub fn value_identifier(mut self, field_name: impl Into<String>, output_alias: impl Into<String>) -> Self {
        self.value_identifiers.push((field_name.into(), output_alias.into()));
        self
    }

    /// Add the fractional bin of a field
    pub fn binning(mut self, binning: Binning) -> Self {
        self.binnings.push(binning);
        self
    }

    /// Keep the rows whose field compares to a number
    pub fn filter(mut self, field_name: impl Into<String>, op: FilterOp, value: f64) -> Self {
        self.scalar_filters.push(ScalarFilter { field_name: field_name.into(), op, value });
        self
    }

    /// Keep the rows whose field is in a field of another table
    pub fn semi_join_filter(
        mut self,
        field_name: impl Into<String>,
        table_name: impl Into<String>,
        join_field_name: impl Into<String>,
    ) -> Self {
        self.semi_join_filters.push(SemiJoinFilter {
            field_name: field_name.into(),
            table_name: table_name.into(),
            join_field_name: join_field_name.into(),
        });
        self
    }

    /// Group the rows, a later grouping replaces an earlier one
    pub fn group_by(mut self, group_by: GroupBy) -> Self {
        self.group_by = Some(group_by);
        self
    }

    /// Order the rows and limit them, a later order replaces an earlier one with its limit
    pub fn order_by(mut self, constraints: Vec<OrderByConstraint>, limit: Option<u64>) -> Self {
        self.order_by = Some(constraints);
        self.limit = limit;
        self
    }

    /// Select fields, all fields without
    pub fn project(mut self, fields: Vec<String>) -> Self {
        self.projection = Some(fields);
        self
    }

    /// The SQL
    pub fn to_sql(&self) -> String {
        let mut ctes: Vec<String> = Vec::new();
        let mut prev = quote_identifier(&self.input_table);

        // 1. Value identifiers
        if !self.value_identifiers.is_empty() {
            let windows: Vec<String> = self
                .value_identifiers
                .iter()
                .map(|(field, alias)| {
                    let (field, alias) = (quote_identifier(field), quote_identifier(alias));
                    format!("dense_rank() OVER (ORDER BY {field} ASC NULLS LAST) AS {alias}")
                })
                .collect();
            push_cte(&mut ctes, "__value_ids", &format!("SELECT *, {} FROM {prev}", windows.join(", ")));
            prev = "__value_ids".to_string();
        }

        // 2. Binning
        if !self.binnings.is_empty() {
            let mut bin_exprs = Vec::new();
            let mut stats_joins = Vec::new();
            for (idx, binning) in self.binnings.iter().enumerate() {
                let conversion = binning.to_numeric;
                let alias = format!("__bs{idx}");
                let min = to_numeric(&quote_identifier(&binning.stats_min_field), conversion);
                let max = to_numeric(&quote_identifier(&binning.stats_max_field), conversion);
                let range = format!("ABS({max} - {min})");
                let width = bin_width_expression(&range, binning.bin_count, binning.min_bin_width);
                let stats_table = quote_identifier(&binning.stats_table);
                let sub = format!("SELECT {min} AS __min, {width} AS __bin_width FROM {stats_table}");
                stats_joins.push(format!("CROSS JOIN ({sub}) {alias}"));
                bin_exprs.push(format!(
                    "({} - {alias}.__min) / {alias}.__bin_width AS {}",
                    to_numeric(&format!("t.{}", quote_identifier(&binning.field_name)), conversion),
                    quote_identifier(&binning.output_alias)
                ));
            }
            let body = format!("SELECT t.*, {} FROM {prev} t {}", bin_exprs.join(", "), stats_joins.join(" "));
            push_cte(&mut ctes, "__binning", &body);
            prev = "__binning".to_string();
        }

        // 3. Scalar filters
        if !self.scalar_filters.is_empty() {
            let conditions: Vec<String> = self
                .scalar_filters
                .iter()
                .map(|f| format!("{} {} {}", quote_identifier(&f.field_name), filter_op(f.op), format_number(f.value)))
                .collect();
            push_cte(&mut ctes, "__filtered", &format!("SELECT * FROM {prev} WHERE {}", conditions.join(" AND ")));
            prev = "__filtered".to_string();
        }

        // 3b. Semi-join filters
        for (i, filter) in self.semi_join_filters.iter().enumerate() {
            let name = format!("__semi_{i}");
            let body = format!(
                "SELECT * FROM {prev} WHERE {} IN (SELECT {} FROM {})",
                quote_identifier(&filter.field_name),
                quote_identifier(&filter.join_field_name),
                quote_identifier(&filter.table_name)
            );
            push_cte(&mut ctes, &name, &body);
            prev = name;
        }

        // 4. Grouping
        if let Some(group_by) = &self.group_by {
            let binned = group_by.keys.iter().enumerate().find_map(|(i, key)| key.binning.as_ref().map(|b| (i, b)));
            prev = match binned {
                Some((key_index, binning)) => build_binned_group_by(&mut ctes, &prev, group_by, key_index, binning),
                None => build_simple_group_by(&mut ctes, &prev, group_by),
            };
        }

        let select = match &self.projection {
            Some(fields) => fields.iter().map(|f| quote_identifier(f)).collect::<Vec<_>>().join(", "),
            None => "*".to_string(),
        };
        let mut final_select = format!("SELECT {select} FROM {prev}");

        // 5. Order and limit
        if let Some(order_by) = self.order_by.as_ref().filter(|order_by| !order_by.is_empty()) {
            let items: Vec<String> = order_by.iter().map(format_order_by_item).collect();
            final_select.push_str(&format!("\nORDER BY {}", items.join(", ")));
        }
        if let Some(limit) = self.limit {
            final_select.push_str(&format!("\nLIMIT {limit}"));
        }

        if ctes.is_empty() {
            return final_select;
        }
        format!("WITH\n  {}\n{final_select}", ctes.join(",\n  "))
    }
}

fn aggregate_selects(group_by: &GroupBy) -> impl Iterator<Item = String> + '_ {
    group_by
        .aggregates
        .iter()
        .map(|a| format!("{} AS {}", format_aggregate(&a.func), quote_identifier(&a.output_alias)))
}

fn build_simple_group_by(ctes: &mut Vec<String>, prev: &str, group_by: &GroupBy) -> String {
    let mut select: Vec<String> = group_by
        .keys
        .iter()
        .map(|k| format!("{} AS {}", quote_identifier(&k.field_name), quote_identifier(&k.output_alias)))
        .collect();
    select.extend(aggregate_selects(group_by));
    let select = select.join(", ");
    let body = if group_by.keys.is_empty() {
        format!("SELECT {select} FROM {prev}")
    } else {
        format!("SELECT {select} FROM {prev} GROUP BY {}", group_by_positions(group_by.keys.len()))
    };
    push_cte(ctes, "__grouped", &body);
    "__grouped".to_string()
}

fn build_binned_group_by(
    ctes: &mut Vec<String>,
    prev: &str,
    group_by: &GroupBy,
    binned_key: usize,
    binning: &GroupByKeyBinning,
) -> String {
    let bin_count = i64::from(binning.bin_count);
    let total_bins = if binning.include_null_bin { bin_count + 1 } else { bin_count };
    let conversion = binning.to_numeric;
    let is_temporal = conversion.is_some_and(ToNumeric::is_temporal);
    let Some(key) = group_by.keys.get(binned_key) else {
        return build_simple_group_by(ctes, prev, group_by);
    };
    let bin_alias = quote_identifier(&key.output_alias);
    let key_field = format!("t.{}", quote_identifier(&key.field_name));

    // Temporal bounds keep the type of the values for formatting, other converted values (e.g. booleans) use a
    // numeric minimum.
    let min_field = quote_identifier(&binning.stats_min_field);
    let max_field = quote_identifier(&binning.stats_max_field);
    let width = bin_width_expression(
        &format!("ABS({} - {})", to_numeric(&max_field, conversion), to_numeric(&min_field, conversion)),
        binning.bin_count,
        binning.min_bin_width,
    );
    let min = if is_temporal { min_field.clone() } else { to_numeric(&min_field, conversion) };
    let stats_sql =
        format!("SELECT {min} AS __min, {width} AS __bin_width FROM {}", quote_identifier(&binning.stats_table));
    push_cte(ctes, "__grp_stats", &stats_sql);

    let bin_expr = match &binning.pre_binned_field_name {
        Some(field) => format!("t.{}", quote_identifier(field)),
        None if is_temporal => {
            format!("({} - {}) / s.__bin_width", to_numeric(&key_field, conversion), to_numeric("s.__min", conversion))
        }
        None => format!("({} - s.__min) / s.__bin_width", to_numeric(&key_field, conversion)),
    };

    // The fractional bin is clamped to [0, binCount - 1] before the cast to INTEGER: a non-finite value (NaN, +-Inf)
    // or a column of nearly one value with the smallest width can floor to NaN or far outside of INT32, a bare cast
    // would fail. Hyper orders NaN above every number, so NaN (e.g. of +Inf with an infinite width) lands in the last
    // bin (computations_edge_cases.test.ts).
    let last_bin = bin_count - 1;
    let clamped = format!(
        "CASE WHEN FLOOR({bin_expr}) >= {bin_count} THEN {last_bin} \
         WHEN FLOOR({bin_expr}) >= 0 THEN FLOOR({bin_expr}) ELSE 0 END"
    );
    let floored = format!("CAST({clamped} AS INTEGER)");
    let bin_case = if binning.include_null_bin {
        format!("CASE WHEN {key_field} IS NULL THEN {bin_count} ELSE {floored} END")
    } else {
        floored
    };

    let mut select: Vec<String> = Vec::new();
    for (i, k) in group_by.keys.iter().enumerate() {
        if i == binned_key {
            select.push(format!("{bin_case} AS {bin_alias}"));
        } else {
            select.push(format!("{} AS {}", quote_identifier(&k.field_name), quote_identifier(&k.output_alias)));
        }
    }
    select.extend(aggregate_selects(group_by));
    let grouped_sql = format!(
        "SELECT {} FROM {prev} t CROSS JOIN __grp_stats s GROUP BY {}",
        select.join(", "),
        group_by_positions(group_by.keys.len())
    );
    push_cte(ctes, "__grouped", &grouped_sql);

    let all_bins_sql = format!("SELECT * FROM generate_series(0, {}) AS bins({bin_alias})", total_bins - 1);
    push_cte(ctes, "__all_bins", &all_bins_sql);

    let mut with_bins_select = vec![format!("ab.{bin_alias}")];
    for (i, k) in group_by.keys.iter().enumerate() {
        if i != binned_key {
            with_bins_select.push(format!("g.{}", quote_identifier(&k.output_alias)));
        }
    }
    for aggregate in &group_by.aggregates {
        with_bins_select.push(format!("g.{}", quote_identifier(&aggregate.output_alias)));
    }
    let with_bins_sql = format!(
        "SELECT {} FROM __all_bins ab LEFT JOIN __grouped g ON ab.{bin_alias} = g.{bin_alias}",
        with_bins_select.join(", ")
    );
    push_cte(ctes, "__with_bins", &with_bins_sql);

    // Temporal bounds are epoch milliseconds
    let offset = |offset: &str| {
        if is_temporal {
            format!("{} * 1000.0 + ({offset}) * 1000.0", to_numeric("s.__min", conversion))
        } else {
            format!("s.__min + ({offset})")
        }
    };
    let lower = offset(&format!("{bin_alias} * s.__bin_width"));
    let upper = offset(&format!("({bin_alias} + 1) * s.__bin_width"));
    let (width_expr, lb_expr, ub_expr) = if binning.include_null_bin {
        (
            format!("CASE WHEN {bin_alias} = {bin_count} THEN NULL ELSE s.__bin_width END"),
            format!("CASE WHEN {bin_alias} = {bin_count} THEN NULL ELSE {lower} END"),
            format!("CASE WHEN {bin_alias} = {bin_count} THEN NULL ELSE {upper} END"),
        )
    } else {
        ("s.__bin_width".to_string(), lower, upper)
    };
    let meta_sql = format!(
        "SELECT t.*, {width_expr} AS {}, {lb_expr} AS {}, {ub_expr} AS {} FROM __with_bins t CROSS JOIN __grp_stats s",
        quote_identifier(&binning.output_bin_width_alias),
        quote_identifier(&binning.output_bin_lb_alias),
        quote_identifier(&binning.output_bin_ub_alias)
    );
    push_cte(ctes, "__bin_meta", &meta_sql);
    "__bin_meta".to_string()
}

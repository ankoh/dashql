use std::{collections::HashSet, sync::Arc};

use arrow::array::{ArrayRef, ArrowNativeTypeOp, UInt32Array};
use arrow::array::RecordBatch;
use arrow::datatypes::i256;
use arrow::datatypes::DataType;
use arrow::datatypes::Schema;
use arrow::datatypes::TimeUnit;
use datafusion::prelude::*;
use datafusion::datasource::MemTable;
use datafusion::execution::SessionStateBuilder;
use datafusion_common::{DFSchema, ScalarValue};
use datafusion_expr::{
    col, lit, when,
    expr::WindowFunction as WindowFunctionExpr,
    Expr, JoinType, SortExpr, WindowFunctionDefinition,
    ExprSchemable,
};
use datafusion_functions::math::floor;
use datafusion_functions_aggregate::average::avg_udaf;
use datafusion_functions_aggregate::count::count_udaf;
use datafusion_functions_aggregate::min_max::{max_udaf, min_udaf};
use datafusion_functions_window::rank::dense_rank_udwf;
use datafusion_functions_window::row_number::row_number_udwf;
use prost::Message;
use wasm_bindgen::prelude::*;

use crate::arrow_out::DataFrameIpcStream;
use crate::proto::dashql_compute::{
    AggregationFunction, BinningTransform, DataFrameTransform, FilterOperator,
    FilterTransform, GroupByKeyBinning, GroupByTransform, OrderByTransform,
    RowNumberTransform, ValueIdentifierTransform, ProjectionTransform,
};

/// The main DataFrame type used internally
pub struct DataFrame {
    pub(crate) schema: Arc<Schema>,
    pub(crate) partitions: Vec<Vec<RecordBatch>>,
}

impl DataFrame {
    /// Construct a data frame
    pub fn new(schema: Arc<Schema>, batches: Vec<RecordBatch>) -> DataFrame {
        Self {
            schema,
            partitions: vec![batches],
        }
    }

    /// Create an IPC stream for reading
    pub fn create_ipc_stream(&self) -> Result<DataFrameIpcStream, JsError> {
        DataFrameIpcStream::new(self.schema.clone())
    }

    /// Create a DataFusion DataFrame from our data
    async fn to_datafusion_df(&self, ctx: &SessionContext, table_name: &str) -> anyhow::Result<datafusion::dataframe::DataFrame> {
        // A record batch is internally stored as: `Vec<Arc<dyn Array>>`
        // `.flatten().cloned().collect()` is cheap
        let batches: Vec<RecordBatch> = self.partitions.iter().flatten().cloned().collect();
        let mem_table = MemTable::try_new(self.schema.clone(), vec![batches])?;
        ctx.register_table(table_name, Arc::new(mem_table))?;
        Ok(ctx.table(table_name).await?)
    }

    /// Quote an attribute name
    fn quoted_col(name: &str) -> Expr {
        col(format!("\"{}\"", name))
    }

    /// Build ordering expressions
    fn build_order_by(&self, config: &OrderByTransform) -> Vec<SortExpr> {
        config.constraints.iter()
            .map(|constraint| SortExpr {
                expr: DataFrame::quoted_col(&constraint.field_name),
                asc: constraint.ascending,
                nulls_first: constraint.nulls_first,
            })
            .collect()
    }

    /// Apply ordering to a DataFrame
    fn order_by(&self, df: datafusion::dataframe::DataFrame, config: &OrderByTransform) -> anyhow::Result<datafusion::dataframe::DataFrame> {
        let sort_exprs = self.build_order_by(config);
        let mut df = df.sort(sort_exprs)?;

        if let Some(limit) = config.limit {
            df = df.limit(0, Some(limit as usize))?;
        }

        Ok(df)
    }

    /// Apply row_number window function
    fn compute_row_number(&self, df: datafusion::dataframe::DataFrame, row_num: &RowNumberTransform) -> anyhow::Result<datafusion::dataframe::DataFrame> {
        let window_expr = Expr::WindowFunction(Box::new(WindowFunctionExpr {
            fun: WindowFunctionDefinition::WindowUDF(row_number_udwf()),
            params: datafusion_expr::expr::WindowFunctionParams {
                args: vec![],
                partition_by: vec![],
                order_by: vec![],
                window_frame: datafusion_expr::WindowFrame::new(None),
                null_treatment: None,
            },
        }))
        .alias(&row_num.output_alias);

        // Select all existing columns plus the new window column
        let mut select_exprs: Vec<Expr> = df.schema()
            .fields()
            .iter()
            .map(|f| DataFrame::quoted_col(f.name()))
            .collect();
        select_exprs.push(window_expr);

        Ok(df.select(select_exprs)?)
    }

    /// Apply value identifiers (dense_rank) window functions
    fn compute_value_identifiers(&self, mut df: datafusion::dataframe::DataFrame, ids: &[ValueIdentifierTransform]) -> anyhow::Result<datafusion::dataframe::DataFrame> {
        for ranking in ids.iter() {
            let input_col = DataFrame::quoted_col(&ranking.field_name);

            let window_expr = Expr::WindowFunction(Box::new(WindowFunctionExpr {
                fun: WindowFunctionDefinition::WindowUDF(dense_rank_udwf()),
                params: datafusion_expr::expr::WindowFunctionParams {
                    args: vec![],
                    partition_by: vec![],
                    order_by: vec![SortExpr {
                        expr: input_col,
                        asc: true,
                        nulls_first: false,
                    }],
                    window_frame: datafusion_expr::WindowFrame::new(Some(true)),
                    null_treatment: None,
                },
            }))
            .alias(&ranking.output_alias);

            // Select all existing columns plus the new window column
            let mut select_exprs: Vec<Expr> = df.schema()
                .fields()
                .iter()
                .map(|f| DataFrame::quoted_col(f.name()))
                .collect();
            select_exprs.push(window_expr);

            df = df.select(select_exprs)?;
        }
        Ok(df)
    }

    /// Get binning parameters from statistics table
    fn get_binning_params(
        &self,
        field_name: &str,
        mut bin_count: u32,
        stats: &DataFrame,
        stats_minimum_field_name: &str,
        stats_maximum_field_name: &str,
        input_schema: &arrow::datatypes::SchemaRef,
    ) -> anyhow::Result<BinningMetadata> {
        // Validate statistics frame
        if stats.partitions.is_empty() || stats.partitions[0].is_empty() || stats.partitions[0][0].num_rows() != 1 {
            return Err(anyhow::anyhow!("statistics data must have exactly 1 row"));
        }
        bin_count = bin_count.max(1);

        let stats_batch = &stats.partitions[0][0];
        let stats_schema = stats_batch.schema_ref();

        // Resolve key field
        let value_field_id = input_schema.index_of(field_name)
            .map_err(|_| anyhow::anyhow!("input data does not contain the key field `{}`", field_name))?;
        let value_field = &input_schema.fields()[value_field_id];
        let value_type = value_field.data_type().clone();

        // Resolve min field
        let min_field_id = stats_schema.index_of(stats_minimum_field_name)
            .map_err(|_| anyhow::anyhow!("statistics data does not contain the field storing the binning minimum `{}`", stats_minimum_field_name))?;
        let min_field = &stats_schema.fields()[min_field_id];

        // Resolve max field
        let max_field_id = stats_schema.index_of(stats_maximum_field_name)
            .map_err(|_| anyhow::anyhow!("statistics data does not contain the field storing the binning maximum `{}`", stats_maximum_field_name))?;
        let max_field = &stats_schema.fields()[max_field_id];

        // Type validation
        if min_field.data_type() != &value_type {
            return Err(anyhow::anyhow!("types of key field `{}` and minimum field `{}` do not match: {} != {}", 
                value_field.name(), min_field.name(), value_type, min_field.data_type()));
        }
        if max_field.data_type() != &value_type {
            return Err(anyhow::anyhow!("types of key field `{}` and maximum field `{}` do not match: {} != {}", 
                value_field.name(), max_field.name(), value_type, max_field.data_type()));
        }

        // Read min/max values
        let max_value = ScalarValue::try_from_array(&stats_batch.columns()[max_field_id], 0)?;
        let min_value = ScalarValue::try_from_array(&stats_batch.columns()[min_field_id], 0)?;

        // Compute bin width based on data type
        let binning_metadata = match &value_type {
            DataType::Float32 => {
                let bin_width = match max_value
                    .sub(min_value.clone())?
                    .cast_to(&DataType::Float32)?
                    .div(ScalarValue::Float32(Some(bin_count as f32)))?
                {
                    ScalarValue::Float32(Some(0.0)) => ScalarValue::Float32(Some(1.0)),
                    ScalarValue::Float32(Some(v)) => ScalarValue::Float32(Some(v.abs())),
                    ScalarValue::Float32(None) => ScalarValue::Float32(None),
                    _ => unreachable!(),
                };
                BinningMetadata {
                    min_value,
                    bin_width,
                    cast_bin_width_type: DataType::Float32,
                    cast_bin_bounds_type: value_type.clone(),
                    value_type: value_type.clone(),
                }
            }
            DataType::Float64 => {
                let bin_width = match max_value
                    .sub(min_value.clone())?
                    .cast_to(&DataType::Float64)?
                    .div(ScalarValue::Float64(Some(bin_count as f64)))?
                {
                    ScalarValue::Float64(Some(0.0)) => ScalarValue::Float64(Some(1.0)),
                    ScalarValue::Float64(Some(v)) => ScalarValue::Float64(Some(v.abs())),
                    ScalarValue::Float64(None) => ScalarValue::Float64(None),
                    _ => unreachable!(),
                };
                BinningMetadata {
                    min_value,
                    bin_width,
                    cast_bin_width_type: DataType::Float64,
                    cast_bin_bounds_type: value_type.clone(),
                    value_type: value_type.clone(),
                }
            }
            DataType::UInt8 | DataType::UInt16 | DataType::UInt32 | DataType::UInt64 => {
                let bin_width = match max_value
                    .sub(min_value.clone())?
                    .cast_to(&DataType::UInt64)?
                    .div(ScalarValue::UInt64(Some(bin_count as u64)))?
                {
                    ScalarValue::UInt64(Some(0)) => ScalarValue::UInt64(Some(1)),
                    ScalarValue::UInt64(Some(v)) => ScalarValue::UInt64(Some(v)),
                    ScalarValue::UInt64(None) => ScalarValue::UInt64(None),
                    _ => unreachable!(),
                };
                BinningMetadata {
                    min_value,
                    bin_width,
                    cast_bin_width_type: DataType::UInt64,
                    cast_bin_bounds_type: value_type.clone(),
                    value_type: value_type.clone(),
                }
            }
            DataType::Int8 | DataType::Int16 | DataType::Int32 | DataType::Int64 => {
                let bin_width = match max_value
                    .sub(min_value.clone())?
                    .cast_to(&DataType::Int64)?
                    .div(ScalarValue::Int64(Some(bin_count as i64)))?
                {
                    ScalarValue::Int64(Some(0)) => ScalarValue::Int64(Some(1)),
                    ScalarValue::Int64(Some(v)) => ScalarValue::Int64(Some(v.abs())),
                    ScalarValue::Int64(None) => ScalarValue::Int64(None),
                    _ => unreachable!(),
                };
                BinningMetadata {
                    min_value,
                    bin_width,
                    cast_bin_width_type: DataType::Int64,
                    cast_bin_bounds_type: value_type.clone(),
                    value_type: value_type.clone(),
                }
            }
            DataType::Timestamp(_, _) => {
                let bin_width = match max_value
                    .sub(min_value.clone())?
                    .cast_to(&DataType::Int64)?
                    .div(ScalarValue::Int64(Some(bin_count as i64)))?
                {
                    ScalarValue::Int64(Some(0)) => ScalarValue::Int64(Some(1)),
                    ScalarValue::Int64(Some(v)) => ScalarValue::Int64(Some(v.abs())),
                    ScalarValue::Int64(None) => ScalarValue::Int64(None),
                    _ => unreachable!(),
                };
                BinningMetadata {
                    min_value,
                    bin_width,
                    cast_bin_width_type: DataType::Duration(TimeUnit::Millisecond),
                    cast_bin_bounds_type: value_type.clone(),
                    value_type: value_type.clone(),
                }
            }
            DataType::Time32(_) => {
                let max_value = max_value.cast_to(&DataType::Int32)?;
                let min_value = min_value.cast_to(&DataType::Int32)?;
                let bin_width = match max_value
                    .sub(min_value.clone())?
                    .div(ScalarValue::Int32(Some(bin_count as i32)))?
                {
                    ScalarValue::Int32(Some(0)) => ScalarValue::Int32(Some(1)),
                    ScalarValue::Int32(Some(v)) => ScalarValue::Int32(Some(v.abs())),
                    ScalarValue::Int32(None) => ScalarValue::Int32(None),
                    _ => unreachable!(),
                };
                BinningMetadata {
                    min_value,
                    bin_width,
                    cast_bin_width_type: DataType::Int32,
                    cast_bin_bounds_type: value_type.clone(),
                    value_type: value_type.clone(),
                }
            }
            DataType::Time64(_) => {
                let max_value = max_value.cast_to(&DataType::Int64)?;
                let min_value = min_value.cast_to(&DataType::Int64)?;
                let bin_width = match max_value
                    .sub(min_value.clone())?
                    .div(ScalarValue::Int64(Some(bin_count as i64)))?
                {
                    ScalarValue::Int64(Some(0)) => ScalarValue::Int64(Some(1)),
                    ScalarValue::Int64(Some(v)) => ScalarValue::Int64(Some(v.abs())),
                    ScalarValue::Int64(None) => ScalarValue::Int64(None),
                    _ => unreachable!(),
                };
                BinningMetadata {
                    min_value,
                    bin_width,
                    cast_bin_width_type: DataType::Int64,
                    cast_bin_bounds_type: value_type.clone(),
                    value_type: value_type.clone(),
                }
            }
            DataType::Date32 | DataType::Date64 => {
                let max_value = max_value.cast_to(&DataType::Timestamp(TimeUnit::Millisecond, None))?;
                let min_value = min_value.cast_to(&DataType::Timestamp(TimeUnit::Millisecond, None))?;
                let bin_width = match max_value
                    .sub(min_value.clone())?
                    .cast_to(&DataType::Int64)?
                    .div(ScalarValue::Int64(Some(bin_count as i64)))?
                {
                    ScalarValue::Int64(Some(0)) => ScalarValue::Int64(Some(1)),
                    ScalarValue::Int64(Some(v)) => ScalarValue::Int64(Some(v.abs())),
                    ScalarValue::Int64(None) => ScalarValue::Int64(None),
                    _ => unreachable!(),
                };
                BinningMetadata {
                    min_value,
                    bin_width,
                    cast_bin_width_type: DataType::Duration(TimeUnit::Millisecond),
                    cast_bin_bounds_type: value_type.clone(),
                    value_type: value_type.clone(),
                }
            }
            DataType::Decimal128(precision, scale) => {
                let max_value = max_value.cast_to(&DataType::Decimal256(*precision, *scale))?;
                let min_value = min_value.cast_to(&DataType::Decimal256(*precision, *scale))?;
                let bin_width = match max_value
                    .sub(min_value.clone())?
                    .div(ScalarValue::Decimal256(Some(i256::from(bin_count as i64) * i256::from(10).pow_wrapping(*scale as u32)), *precision, *scale))?
                {
                    ScalarValue::Decimal256(Some(i256::ZERO), p, s) => ScalarValue::Decimal256(Some(i256::ONE), p, s),
                    ScalarValue::Decimal256(Some(v), p, s) => ScalarValue::Decimal256(Some(v.wrapping_abs()), p, s),
                    ScalarValue::Decimal256(None, p, s) => ScalarValue::Decimal256(None, p, s),
                    _ => unreachable!(),
                };
                BinningMetadata {
                    min_value: min_value.cast_to(&DataType::Decimal128(*precision, *scale))?,
                    bin_width,
                    cast_bin_width_type: DataType::Decimal128(*precision, *scale),
                    cast_bin_bounds_type: DataType::Decimal128(*precision, *scale),
                    value_type: value_type.clone(),
                }
            }
            DataType::Decimal256(precision, scale) => {
                let bin_width = match max_value
                    .sub(min_value.clone())?
                    .div(ScalarValue::Decimal256(Some(i256::from(bin_count as i64) * i256::from(10).pow_wrapping(*scale as u32)), *precision, *scale))?
                {
                    ScalarValue::Decimal256(Some(i256::ZERO), p, s) => ScalarValue::Decimal256(Some(i256::ONE), p, s),
                    ScalarValue::Decimal256(Some(v), p, s) => ScalarValue::Decimal256(Some(v.wrapping_abs()), p, s),
                    ScalarValue::Decimal256(None, p, s) => ScalarValue::Decimal256(None, p, s),
                    _ => unreachable!(),
                };
                BinningMetadata {
                    min_value,
                    bin_width,
                    cast_bin_width_type: DataType::Decimal256(*precision, *scale),
                    cast_bin_bounds_type: DataType::Decimal256(*precision, *scale),
                    value_type: value_type.clone(),
                }
            }
            _ => return Err(anyhow::anyhow!("key binning is not implemented for data type: {}", value_type))
        };

        Ok(binning_metadata)
    }

    /// Create bin expression for a field
    fn create_bin_expr(&self, field_name: &str, metadata: &BinningMetadata, df_schema: &DFSchema) -> anyhow::Result<Expr> {
        let value = DataFrame::quoted_col(field_name);
        let min_value = lit(metadata.min_value.clone());
        // Use safe conversion for decimals to avoid arrow-cast panic on large values
        let bin_width_f64 = lit(scalar_to_f64_safe(&metadata.bin_width)
            .map(|f| ScalarValue::Float64(Some(f)))
            .unwrap_or_else(|| metadata.bin_width.clone()));

        // Compute: (value - min) / bin_width as Float64
        let bin_expr = match &metadata.value_type {
            DataType::Timestamp(_, _) => {
                // Cast timestamp difference to int64 then to f64
                let min_delta = value.clone() - min_value;
                let min_delta_i64 = min_delta.clone().cast_to(&DataType::Int64, df_schema).unwrap_or(min_delta);
                let min_delta_f64 = min_delta_i64.clone().cast_to(&DataType::Float64, df_schema).unwrap_or(min_delta_i64);
                min_delta_f64 / bin_width_f64
            }
            DataType::Time32(_) => {
                let value_i32 = value.clone().cast_to(&DataType::Int32, df_schema).unwrap_or(value);
                let min_delta = value_i32 - min_value;
                let min_delta_f64 = min_delta.clone().cast_to(&DataType::Float64, df_schema).unwrap_or(min_delta);
                min_delta_f64 / bin_width_f64
            }
            DataType::Time64(_) => {
                let value_i64 = value.clone().cast_to(&DataType::Int64, df_schema).unwrap_or(value);
                let min_delta = value_i64 - min_value;
                let min_delta_f64 = min_delta.clone().cast_to(&DataType::Float64, df_schema).unwrap_or(min_delta);
                min_delta_f64 / bin_width_f64
            }
            DataType::Date32 | DataType::Date64 => {
                let value_ts = value.clone().cast_to(&DataType::Timestamp(TimeUnit::Millisecond, None), df_schema).unwrap_or(value);
                let min_delta = value_ts - min_value;
                let min_delta_i64 = min_delta.clone().cast_to(&DataType::Int64, df_schema).unwrap_or(min_delta);
                let min_delta_f64 = min_delta_i64.clone().cast_to(&DataType::Float64, df_schema).unwrap_or(min_delta_i64);
                min_delta_f64 / bin_width_f64
            }
            DataType::Decimal128(precision, scale) => {
                let value_d256 = value.clone().cast_to(&DataType::Decimal256(*precision, *scale), df_schema).unwrap_or(value);
                let min_value_d256 = lit(metadata.min_value.cast_to(&DataType::Decimal256(*precision, *scale)).unwrap_or(metadata.min_value.clone()));
                let bin_width_d256 = lit(metadata.bin_width.clone());
                let min_delta = value_d256 - min_value_d256;
                let bin_d256 = min_delta / bin_width_d256;
                let bin_d128 = bin_d256.clone().cast_to(&DataType::Decimal128(*precision, *scale), df_schema).unwrap_or(bin_d256);
                Expr::TryCast(datafusion_expr::expr::TryCast {
                    expr: Box::new(bin_d128),
                    data_type: DataType::Float64,
                })
            }
            DataType::Decimal256(precision, scale) => {
                let min_delta = value - min_value;
                let bin_width_d256 = lit(metadata.bin_width.clone());
                let bin_d256 = min_delta / bin_width_d256;
                let bin_d128 = bin_d256.clone().cast_to(&DataType::Decimal128(*precision, *scale), df_schema).unwrap_or(bin_d256);
                Expr::TryCast(datafusion_expr::expr::TryCast {
                    expr: Box::new(bin_d128),
                    data_type: DataType::Float64,
                })
            }
            _ => {
                // For numeric types, simple arithmetic
                let min_delta = value - min_value;
                let min_delta_f64 = min_delta.clone().cast_to(&DataType::Float64, df_schema).unwrap_or(min_delta);
                min_delta_f64 / bin_width_f64
            }
        };
        Ok(bin_expr)
    }

    /// Apply binning transforms
    fn bin_fields(
        &self,
        df: datafusion::dataframe::DataFrame,
        bin_fields: &[BinningTransform],
        table_args: &[&DataFrame],
    ) -> anyhow::Result<datafusion::dataframe::DataFrame> {
        if bin_fields.is_empty() {
            return Ok(df);
        }

        let df_schema = df.schema();
        let input_schema: Arc<Schema> = Arc::clone(df_schema.inner());
        let mut select_exprs: Vec<Expr> = df_schema
            .fields()
            .iter()
            .map(|f| DataFrame::quoted_col(f.name()))
            .collect();

        for binning in bin_fields.iter() {
            if (binning.stats_table_id as usize) >= table_args.len() {
                return Err(anyhow::anyhow!("failed to resolve aggregate table for field binning"));
            }
            let stats_table = table_args[binning.stats_table_id as usize];

            let metadata = self.get_binning_params(
                &binning.field_name,
                binning.bin_count,
                stats_table,
                &binning.stats_minimum_field_name,
                &binning.stats_maximum_field_name,
                &input_schema,
            )?;

            let bin_expr = self.create_bin_expr(&binning.field_name, &metadata, &df_schema)?;
            select_exprs.push(bin_expr.alias(&binning.output_alias));
        }

        Ok(df.select(select_exprs)?)
    }

    /// Apply filter transforms
    async fn filter(
        &self,
        df: datafusion::dataframe::DataFrame,
        ctx: &SessionContext,
        filters: &[FilterTransform],
        table_args: &[&DataFrame],
    ) -> anyhow::Result<datafusion::dataframe::DataFrame> {
        if filters.is_empty() {
            return Ok(df);
        }

        let mut filter_expr: Option<Expr> = None;
        let mut semi_join_filters: Vec<&FilterTransform> = Vec::new();

        for filter in filters.iter() {
            let op = match FilterOperator::try_from(filter.operator)? {
                FilterOperator::Equal => datafusion_expr::Operator::Eq,
                FilterOperator::LessThanLiteral => datafusion_expr::Operator::Lt,
                FilterOperator::LessEqualLiteral => datafusion_expr::Operator::LtEq,
                FilterOperator::GreaterThanLiteral => datafusion_expr::Operator::Gt,
                FilterOperator::GreaterEqualLiteral => datafusion_expr::Operator::GtEq,
                FilterOperator::SemiJoinField => {
                    semi_join_filters.push(filter);
                    continue;
                }
            };

            let field_expr = DataFrame::quoted_col(&filter.field_name);
            let scalar = if let Some(value) = filter.literal_double {
                lit(value as f64)
            } else {
                lit(filter.literal_u64.unwrap_or_default() as u64)
            };

            let pred = Expr::BinaryExpr(datafusion_expr::expr::BinaryExpr::new(
                Box::new(field_expr),
                op,
                Box::new(scalar),
            ));

            filter_expr = Some(match filter_expr {
                Some(existing) => existing.and(pred),
                None => pred,
            });
        }

        // Apply scalar filter predicates
        let mut result_df = match filter_expr {
            Some(expr) => df.filter(expr)?,
            None => df,
        };

        // Apply semi-join filters
        for (idx, filter) in semi_join_filters.iter().enumerate() {
            let semi_join = filter.semi_join_field.as_ref()
                .ok_or_else(|| anyhow::anyhow!("semi_join_field is required for SemiJoinField operator"))?;

            if (semi_join.table_id as usize) >= table_args.len() {
                return Err(anyhow::anyhow!("failed to resolve table for semi-join filter"));
            }

            let join_table = table_args[semi_join.table_id as usize];
            let join_table_name = format!("__semi_join_{}", idx);
            // A record batch is internally stored as: `Vec<Arc<dyn Array>>`
            // `.flatten().cloned().collect()` is cheap
            let join_batches: Vec<RecordBatch> = join_table.partitions.iter().flatten().cloned().collect();
            let join_mem_table = MemTable::try_new(join_table.schema.clone(), vec![join_batches])?;
            ctx.register_table(&join_table_name, Arc::new(join_mem_table))?;
            let join_df = ctx.table(&join_table_name).await?;

            // Perform semi-join: keep rows from left where field matches right table's field
            result_df = result_df.join(
                join_df,
                JoinType::LeftSemi,
                &[filter.field_name.as_str()],
                &[semi_join.field_name.as_str()],
                None,
            )?;
        }

        Ok(result_df)
    }

    /// Apply group by transforms
    async fn group_by(
        &self,
        df: datafusion::dataframe::DataFrame,
        ctx: &SessionContext,
        config: &GroupByTransform,
        table_args: &[&DataFrame],
    ) -> anyhow::Result<datafusion::dataframe::DataFrame> {
        let mut output_field_names: HashSet<&str> = HashSet::new();
        let df_schema = df.schema();
        let input_schema: Arc<Schema> = Arc::clone(df_schema.inner());

        // Collect grouping expressions and track binned groups
        let mut group_exprs: Vec<Expr> = Vec::new();
        let mut binned_group: Option<(&str, &GroupByKeyBinning, BinningMetadata)> = None;

        for key in config.keys.iter() {
            if output_field_names.contains(key.output_alias.as_str()) {
                return Err(anyhow::anyhow!("duplicate output name `{}`", key.output_alias.as_str()));
            }

            let key_expr: Expr = if let Some(binning) = &key.binning {
                if binned_group.is_some() {
                    return Err(anyhow::anyhow!("cannot bin more than one key"));
                }
                if (binning.stats_table_id as usize) >= table_args.len() {
                    return Err(anyhow::anyhow!("failed to resolve aggregate table for field binning"));
                }
                let stats_table = table_args[binning.stats_table_id as usize];

                let metadata = self.get_binning_params(
                    &key.field_name,
                    binning.bin_count,
                    stats_table,
                    &binning.stats_minimum_field_name,
                    &binning.stats_maximum_field_name,
                    &input_schema,
                )?;

                // Check for pre-binned field
                let bin_f64 = if let Some(pre_binned_name) = &binning.pre_binned_field_name {
                    let pre_binned_field_id = input_schema.index_of(pre_binned_name)
                        .map_err(|_| anyhow::anyhow!("input does not contain the pre-computed bin field `{}`", pre_binned_name))?;
                    let pre_binned_field = input_schema.field(pre_binned_field_id);
                    if pre_binned_field.data_type() != &DataType::Float64 {
                        return Err(anyhow::anyhow!("input contains a pre-computed bin field `{}`, but with wrong type: {} != Float64", 
                            pre_binned_name, pre_binned_field.data_type()));
                    }
                    DataFrame::quoted_col(pre_binned_name)
                } else {
                    self.create_bin_expr(&key.field_name, &metadata, &df_schema)?
                };

                // Floor and cast to UInt32, then clamp
                let floor_udf = floor();
                let bin_floored = floor_udf.call(vec![bin_f64]);
                let bin_u32 = bin_floored.clone()
                    .cast_to(&DataType::UInt32, &*df_schema)
                    .unwrap_or(bin_floored);

                // Clamp: CASE WHEN bin >= bin_count THEN bin_count - 1 ELSE bin END
                let bin_count = binning.bin_count;
                let clamped = when(
                    bin_u32.clone().gt_eq(lit(bin_count)),
                    lit(bin_count - 1)
                ).otherwise(bin_u32)?;

                binned_group = Some((&key.output_alias, binning, metadata));
                clamped
            } else {
                DataFrame::quoted_col(&key.field_name)
            };

            group_exprs.push(key_expr.alias(&key.output_alias));
            output_field_names.insert(&key.output_alias);
        }

        // Collect aggregate expressions
        let mut aggr_exprs: Vec<Expr> = Vec::new();
        for aggr in config.aggregates.iter() {
            if output_field_names.contains(aggr.output_alias.as_str()) {
                return Err(anyhow::anyhow!("duplicate output name `{}`", aggr.output_alias.as_str()));
            }

            let aggr_func: AggregationFunction = aggr.aggregation_function.try_into()?;
            let field_name = aggr.field_name.as_deref().unwrap_or("");

            // Validate distinct usage
            match aggr_func {
                AggregationFunction::Min | AggregationFunction::Max | AggregationFunction::Average => {
                    if aggr.aggregate_distinct.unwrap_or_default() {
                        return Err(anyhow::anyhow!("function '{}' does not support distinct aggregation", aggr_func.as_str_name()));
                    }
                }
                AggregationFunction::Count | AggregationFunction::CountStar => {}
            }

            let aggr_expr = match aggr_func {
                AggregationFunction::Min => {
                    Expr::AggregateFunction(datafusion_expr::expr::AggregateFunction {
                        func: min_udaf(),
                        params: datafusion_expr::expr::AggregateFunctionParams {
                            args: vec![DataFrame::quoted_col(field_name)],
                            distinct: false,
                            filter: None,
                            order_by: None,
                            null_treatment: None,
                        },
                    })
                }
                AggregationFunction::Max => {
                    Expr::AggregateFunction(datafusion_expr::expr::AggregateFunction {
                        func: max_udaf(),
                        params: datafusion_expr::expr::AggregateFunctionParams {
                            args: vec![DataFrame::quoted_col(field_name)],
                            distinct: false,
                            filter: None,
                            order_by: None,
                            null_treatment: None,
                        },
                    })
                }
                AggregationFunction::Average => {
                    Expr::AggregateFunction(datafusion_expr::expr::AggregateFunction {
                        func: avg_udaf(),
                        params: datafusion_expr::expr::AggregateFunctionParams {
                            args: vec![DataFrame::quoted_col(field_name)],
                            distinct: false,
                            filter: None,
                            order_by: None,
                            null_treatment: None,
                        },
                    })
                }
                AggregationFunction::Count => {
                    Expr::AggregateFunction(datafusion_expr::expr::AggregateFunction {
                        func: count_udaf(),
                        params: datafusion_expr::expr::AggregateFunctionParams {
                            args: vec![DataFrame::quoted_col(field_name)],
                            distinct: aggr.aggregate_distinct.unwrap_or_default(),
                            filter: None,
                            order_by: None,
                            null_treatment: None,
                        },
                    })
                }
                AggregationFunction::CountStar => {
                    Expr::AggregateFunction(datafusion_expr::expr::AggregateFunction {
                        func: count_udaf(),
                        params: datafusion_expr::expr::AggregateFunctionParams {
                            args: vec![lit(1i64)],
                            distinct: false,
                            filter: None,
                            order_by: None,
                            null_treatment: None,
                        },
                    })
                }
            };

            aggr_exprs.push(aggr_expr.alias(&aggr.output_alias));
        }

        // Perform aggregation
        let mut result = df.aggregate(group_exprs, aggr_exprs)?;

        // Handle binned groups - create missing bins and compute metadata
        if let Some((bin_field_name, key_binning, metadata)) = binned_group {
            // Create all bins table
            result = self.join_missing_bins(result, ctx, bin_field_name, key_binning.bin_count).await?;

            // Add binning metadata fields
            result = self.compute_binning_metadata_fields(result, bin_field_name, key_binning, &metadata)?;
        }

        Ok(result)
    }

    /// Join with all possible bins to fill in missing ones
    async fn join_missing_bins(
        &self,
        df: datafusion::dataframe::DataFrame,
        ctx: &SessionContext,
        bin_field: &str,
        bin_count: u32,
    ) -> anyhow::Result<datafusion::dataframe::DataFrame> {
        // Create table with all bin values
        let all_bins = RecordBatch::try_from_iter(vec![
            (bin_field, Arc::new(UInt32Array::from((0..bin_count).collect::<Vec<u32>>())) as ArrayRef),
        ])?;

        let all_bins_table = MemTable::try_new(
            all_bins.schema(),
            vec![vec![all_bins]],
        )?;

        // Register with unique name
        let all_bins_table_name = format!("__all_bins_{}", bin_field);
        ctx.register_table(&all_bins_table_name, Arc::new(all_bins_table))?;
        let all_bins_df = ctx.table(&all_bins_table_name).await?;

        // Build projection: bin_field from left, all other fields from right
        let mut select_exprs: Vec<Expr> = vec![col(format!("__all_bins.\"{}\"", bin_field))];
        for field in df.schema().fields() {
            if field.name() != bin_field {
                select_exprs.push(col(format!("__grouped.\"{}\"", field.name())).alias(field.name().as_str()));
            }
        }

        // Left join: all_bins LEFT JOIN grouped ON bin_field
        let joined = all_bins_df
            .alias("__all_bins")?
            .join(
                df.alias("__grouped")?,
                JoinType::Left,
                &[bin_field],
                &[bin_field],
                None,
            )?
            .select(select_exprs)?;

        Ok(joined)
    }

    /// Add binning metadata fields (bin_width, bin_lb, bin_ub)
    fn compute_binning_metadata_fields(
        &self,
        df: datafusion::dataframe::DataFrame,
        bin_field_name: &str,
        key_binning: &GroupByKeyBinning,
        metadata: &BinningMetadata,
    ) -> anyhow::Result<datafusion::dataframe::DataFrame> {
        let df_schema = df.schema();
        let bin_value = DataFrame::quoted_col(bin_field_name);
        let min_value = lit(metadata.min_value.clone());
        let bin_width = lit(metadata.bin_width.clone());

        // Cast bin value for offset arithmetic
        let bin_value_casted = bin_value.clone()
            .cast_to(&metadata.bin_width.data_type(), &*df_schema)
            .unwrap_or(bin_value);

        // offset_lb = bin * width
        let offset_lb = bin_value_casted.clone() * bin_width.clone();
        // offset_ub = offset_lb + width
        let offset_ub = offset_lb.clone() + bin_width.clone();

        // bin_width field (cast to target type)
        let bin_width_casted = bin_width.clone()
            .cast_to(&metadata.cast_bin_width_type, &*df_schema)
            .unwrap_or(bin_width);

        // bin_lb = min + offset_lb (cast appropriately)
        let offset_lb_casted = offset_lb.clone()
            .cast_to(&metadata.cast_bin_width_type, &*df_schema)
            .unwrap_or(offset_lb);
        let bin_lb = (min_value.clone() + offset_lb_casted).clone()
            .cast_to(&metadata.cast_bin_bounds_type, &*df_schema)
            .unwrap_or(min_value.clone() + lit(metadata.bin_width.clone()));

        // bin_ub = min + offset_ub (cast appropriately)
        let offset_ub_casted = offset_ub.clone()
            .cast_to(&metadata.cast_bin_width_type, &*df_schema)
            .unwrap_or(offset_ub);
        let bin_ub = (min_value.clone() + offset_ub_casted).clone()
            .cast_to(&metadata.cast_bin_bounds_type, &*df_schema)
            .unwrap_or(min_value + lit(metadata.bin_width.clone()));

        // Select all existing fields plus metadata
        let mut select_exprs: Vec<Expr> = df_schema
            .fields()
            .iter()
            .map(|f| DataFrame::quoted_col(f.name()))
            .collect();

        select_exprs.push(bin_width_casted.alias(&key_binning.output_bin_width_alias));
        select_exprs.push(bin_lb.alias(&key_binning.output_bin_lb_alias));
        select_exprs.push(bin_ub.alias(&key_binning.output_bin_ub_alias));

        Ok(df.select(select_exprs)?)
    }

    /// Apply projection
    fn project(
        &self,
        df: datafusion::dataframe::DataFrame,
        config: &ProjectionTransform,
    ) -> anyhow::Result<datafusion::dataframe::DataFrame> {
        let field_names: HashSet<&str> = config.fields.iter()
            .map(|f| f.as_str())
            .collect();

        let proj_exprs: Vec<Expr> = df.schema()
            .fields()
            .iter()
            .filter(|f| field_names.contains(f.name().as_str()))
            .map(|f| DataFrame::quoted_col(f.name()))
            .collect();

        Ok(df.select(proj_exprs)?)
    }

    /// Create a SessionContext with optimizer rules for WASM execution.
    /// 
    /// Note: SimplifyExpressions is intentionally excluded because it uses
    /// deep recursive tree traversal that can overflow the WASM stack when
    /// processing complex expressions with many casts (e.g., binning transforms).
    /// The expressions we build are already in simplified form, so this
    /// optimization pass is not needed.
    fn create_session_context() -> SessionContext {
        use datafusion_optimizer::{
            OptimizerRule,
            optimize_projections::OptimizeProjections,
            push_down_filter::PushDownFilter,
            push_down_limit::PushDownLimit,
        };

        // Subset of DataFusion's default optimizer rules.
        // SimplifyExpressions is excluded to avoid stack overflow in WASM.
        let rules: Vec<Arc<dyn OptimizerRule + Sync + Send>> = vec![
            Arc::new(PushDownLimit::new()),
            Arc::new(PushDownFilter::new()),
            Arc::new(OptimizeProjections::new()),
        ];

        // Create the session state.
        // We're resolving functions ourselves, so we don't need to register all of them
        let state = SessionStateBuilder::new()
            .with_optimizer_rules(rules)
            .build();
        SessionContext::new_with_state(state)
    }

    /// Transform a data frame
    pub async fn transform(&self, transform: &DataFrameTransform, table_args: &[&DataFrame]) -> anyhow::Result<DataFrame> {
        let ctx = Self::create_session_context();
        let mut df = self.to_datafusion_df(&ctx, "__input").await?;

        // Compute row number
        if let Some(row_number) = &transform.row_number {
            df = self.compute_row_number(df, row_number)?;
        }
        // Compute value identifiers
        if !transform.value_identifiers.is_empty() {
            df = self.compute_value_identifiers(df, &transform.value_identifiers)?;
        }
        // Compute binning
        if !transform.binning.is_empty() {
            df = self.bin_fields(df, &transform.binning, table_args)?;
        }
        // Apply filters
        if !transform.filters.is_empty() {
            df = self.filter(df, &ctx, &transform.filters, table_args).await?;
        }
        // Aggregate groups
        if let Some(group_by) = &transform.group_by {
            df = self.group_by(df, &ctx, group_by, table_args).await?;
        }
        // Apply ordering
        if let Some(order_by) = &transform.order_by {
            df = self.order_by(df, order_by)?;
        }
        // Apply projection
        if let Some(project) = &transform.projection {
            df = self.project(df, project)?;
        }
        // Capture schema before collecting (collect consumes the DataFrame)
        let result_schema: Arc<Schema> = Arc::clone(df.schema().inner());

        // Execute and collect results
        let result_batches = df.collect().await?;

        // Use batch schema if available (may have more precise metadata)
        let result_schema = if !result_batches.is_empty() {
            result_batches[0].schema()
        } else {
            result_schema
        };

        Ok(DataFrame::new(result_schema, result_batches))
    }
}

/// Safely convert a ScalarValue to f64, handling Decimal256/128 values that
/// might overflow the arrow-cast library.
fn scalar_to_f64_safe(value: &ScalarValue) -> Option<f64> {
    match value {
        ScalarValue::Decimal256(Some(v), _precision, scale) => {
            // Convert i256 to f64 manually to avoid arrow-cast panic
            // First try to convert to i128 if within range
            let divisor = 10f64.powi(*scale as i32);
            if let Some(v128) = v.to_i128() {
                Some(v128 as f64 / divisor)
            } else {
                None
            }
        }
        ScalarValue::Decimal128(Some(v), _precision, scale) => {
            let divisor = 10f64.powi(*scale as i32);
            Some(*v as f64 / divisor)
        }
        _ => {
            // For other types, try the standard cast_to
            value.cast_to(&DataType::Float64).ok().and_then(|sv| {
                if let ScalarValue::Float64(v) = sv {
                    v
                } else {
                    None
                }
            })
        }
    }
}

/// DataFrame pointer exposed to JS.
/// We wrap the inner DataFrame into an Arc<> here since wasm_bindgen does not support Option<&> args.
#[wasm_bindgen]
pub struct DataFramePtr {
    inner: Arc<DataFrame>,
}

impl Clone for DataFramePtr {
    fn clone(&self) -> Self {
        Self { inner: Arc::clone(&self.inner) }
    }
}

impl DataFramePtr {
    /// Create from a DataFrame
    pub fn from_frame(frame: DataFrame) -> DataFramePtr {
        Self { inner: Arc::new(frame) }
    }

    /// Get a reference to the inner DataFrame
    pub fn as_frame(&self) -> &DataFrame {
        &self.inner
    }
}

#[wasm_bindgen]
impl DataFramePtr {
    /// Clone the data frame pointer (cheap - just bumps reference count)
    #[wasm_bindgen(js_name = "clone")]
    pub fn js_clone(&self) -> DataFramePtr {
        self.clone()
    }
    /// Create an IPC stream for reading
    #[wasm_bindgen(js_name = "createIpcStream")]
    pub fn create_ipc_stream(&self) -> Result<DataFrameIpcStream, JsError> {
        self.inner.create_ipc_stream()
    }
    /// Transform a data frame
    /// Note: stats_table and filter_table are consumed (ownership transferred).
    /// Use DataFramePtr.clone() from JS to pass a handle while retaining the original.
    /// We have to do this since wasm_bindgen is not supporting Option<&DataFrame>.
    #[wasm_bindgen(js_name = "transform")]
    pub async fn transform(&self, proto: &[u8], tables: Vec<DataFramePtr>) -> Result<DataFramePtr, JsError> {
        let transform_config = DataFrameTransform::decode(proto).map_err(|e| JsError::new(&e.to_string()))?;
        let table_refs: Vec<&DataFrame> = tables.iter().map(|t| t.as_frame()).collect();
        let result = self.inner.transform(&transform_config, &table_refs).await.map_err(|e| JsError::new(&e.to_string()))?;
        Ok(DataFramePtr::from_frame(result))
    }
}

/// Metadata for binning operations
struct BinningMetadata {
    min_value: ScalarValue,
    bin_width: ScalarValue,
    cast_bin_width_type: DataType,
    cast_bin_bounds_type: DataType,
    value_type: DataType,
}

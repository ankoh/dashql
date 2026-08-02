-- Fetch and visualize vega cars data from a parquet file, rendering a point
-- chart with year on the x-axis and weight on the y-axis.
VISUALIZE dashql.notebook."vis_data/vega_cars" USING vegalite (
  mark => point,
  encoding => (
    x => (field => "Year", type => temporal),
    y => (field => "Weight_in_lbs", type => quantitative)
  )
);
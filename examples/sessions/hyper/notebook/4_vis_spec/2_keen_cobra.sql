VISUALIZE dashql.notebook."vis_data/vega_cars" USING vegalite (
  mark => point,
  encoding => (
    x => (field => "Year", type => temporal),
    y => (field => "Weight_in_lbs", type => quantitative)
  )
);
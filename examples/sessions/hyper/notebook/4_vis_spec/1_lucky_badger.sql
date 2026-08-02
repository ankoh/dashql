-- Generate a point chart with random quantitative x and y values.
VISUALIZE dashql.notebook."vis_data/random" USING vegalite (
  mark => point,
  encoding => (
    x => (field => x, type => quantitative),
    y => (field => y, type => quantitative)
  )
);
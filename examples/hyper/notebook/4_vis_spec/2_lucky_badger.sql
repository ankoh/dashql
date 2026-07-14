VISUALIZE dashql.notebook."vis_data/random" AS (
  mark => line,
  encoding => (
    x => (field => x, type => quantitative),
    y => (field => y, type => quantitative)
  )
);
VISUALIZE dashql.notebook."vis_data/random" USING vegalite (
  mark => point,
  encoding => (
    x => (field => x, type => quantitative),
    y => (field => y, type => quantitative)
  )
);
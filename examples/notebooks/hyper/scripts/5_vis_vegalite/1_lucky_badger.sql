FROM generate_series(1, 100) t(v)
|> SELECT v AS x, random() AS y
|> VISUALIZE USING vegalite (
  mark => point,
  encoding => (
    x => (field => x, type => quantitative),
    y => (field => y, type => quantitative)
  )
);

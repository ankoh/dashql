-- Generate a random x-value and y-value for each of 100 data points.
select v as x, random() as y from generate_series(1, 100) t(v)
# Convert tbl to parquet

# convert.py <from-dir> <to-dir>

import pandas as pd
import sys

tables = ['nation', 'region', 'part', 'supplier', 'partsupp', 'customer', 'orders', 'lineitem']

for t in tables:
    data = pd.read_csv(sys.argv[1] + '/' + t + '.tbl', delimiter='|')
    data.to_parquet(sys.argv[2] + '/' + t + '.parquet')

# cwcsv

CSV reading and writing

* No allocation on traversing cells and rows
* Supports arbitrary separator, quote and newline symbols
* Support embedded separator, quote and newline symbols in quoted fields
* Reading and writing iterators are compatible with standard algorithms
* Header only
* Unit tested using Catch
* Single-threaded

## Benchmark

A benchmark is included that counts the number of cells and rows in a given file.

Running this on a 758 MB file containing 20 million rows with 6 cells each gives:

```
rows: 20239829
cells: 121438974
cells/row: 6
time: 0.798856 s
rate: 152 cells/us
```

A smaller version of the file is included, `bench/sample.csv`, which yields similar performance of 150 cells per microsecond.

Note this excludes the time taken to load the file into memory.

## Reading

Cells and rows are iterated over using standard range-based for loops.

The cell object contains the methods:

* `to_string()`
* `to_int()`
* `to_long()`
* `to_longlong()`
* `to_double()`

which convert the cell value to the respective type.

It is also possible to get a string view into the raw data:

* `to_string_view()`

which allows you to avoid allocation if no conversion is required.

### Example: from a string literal

```cpp
auto& text = "a,b,c,d,e\n"
             "1,2,3,4,5";

auto parser = csv::make_parser( text );

for( auto&& row : parser ) {
	for( auto&& cell : row ) {
		cout << '[' << cell.to_string_view() << ']';
	}
	cout << '\n';
}
```

### Example: from a file

```cpp
// first load the file into a std::string
auto str = csv::load_file("test.csv");

auto parser = csv::make_parser( str );

for( auto&& row : parser ) {
	for( auto&& cell : row ) {
		cout << '[' << cell.to_string() << ']';
	}
	cout << '\n';
}
```

We can also use standard algorithms:

```cpp
auto row = parser.begin();
++row; // skip header

std::vector<int> data;

std::transform( row.begin(), row.end(), std::back_inserter(data), []( auto&& x ){ return x.to_int(); });

for( auto&& x : data ) {
	cout << '[' << x << ']';
}
cout << '\n';
```

## Writing

### Example: to string

```cpp
std::string out;

auto writer = csv::make_writer( std::back_inserter(out) );

writer.write_row( "Open", "High", "Low", "Close" );
writer.write_row( 101, 102.5, 99.8, 102 );

auto vals = { 100.2, 103.1, 98.6, 101.5 };

writer.write_row_range( vals.begin(), vals.end() );
```

### Example: to file

```cpp
std::ofstream out("test.csv");

auto writer = csv::make_writer( out );

writer.write_row( "Open", "High", "Low", "Close" );
writer.write_row( 101, 102.5, 99.8, 102 );

auto vals = { 100.2, 103.1, 98.6, 101.5 };

writer.write_row_range( vals.begin(), vals.end() );
```

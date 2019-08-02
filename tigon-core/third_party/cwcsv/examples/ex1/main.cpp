#include <iostream>
#include <fstream>
#include <vector>
#include <cwcsv/csv.h>

using namespace std;

int main( int argc, char** argv ) {

	auto& text = "a,b,c,d,e\n"
	             "1,2,3,4,5";

	auto parser = csv::make_parser( text );

	for( auto&& row : parser ) {
		for( auto&& cell : row ) {
			cout << '[' << cell.to_string_view() << ']';
		}
		cout << '\n';
	}

	cout << "=====================\n";
	{
		auto row = parser.begin();
		++row; // skip header

		std::vector<int> data;
	
		std::transform( row.begin(), row.end(), std::back_inserter(data), []( auto&& x ){ return x.to_int(); });
	
		for( auto&& x : data ) {
			cout << '[' << x << ']';
		}
		cout << '\n';
	}
	cout << "=====================\n";
	{

		std::ofstream out("test.csv");

		auto writer = csv::make_writer( out );

		writer.write_row( "Open", "High", "Low", "Close" );
		writer.write_row( 101, 102.5, 99.8, 102 );

		auto vals = { 100.2, 103.1, 98.6, 101.5 };

		writer.write_row_range( vals.begin(), vals.end() );

	}
	cout << "=====================\n";
	{

		auto in = csv::load_file("test.csv");

		auto parser = csv::make_parser( in );

		for( auto&& row : parser ) {
			for( auto&& cell : row ) {
				cout << '[' << cell.to_string() << ']';
			}
			cout << '\n';
		}

	}
	cout << "=====================\n";
	{

		std::string out;

		auto writer = csv::make_writer( std::back_inserter(out) );

		writer.write_row( "Open", "High", "Low", "Close" );
		writer.write_row( 101, 102.5, 99.8, 102 );

		auto vals = { 100.2, 103.1, 98.6, 101.5 };

		writer.write_row_range( vals.begin(), vals.end() );

		cout << out;
	}
	
}


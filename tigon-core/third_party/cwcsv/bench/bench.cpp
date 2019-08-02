#include <iostream>
#include <fstream>
#include <chrono>
#include <cwcsv/csv.h>

void benchmark( const std::string& data, int32_t N ) {
	auto parser = csv::make_parser( data );

	int64_t nb_rows = 0;
	int64_t nb_cells = 0;

	using namespace std::chrono;
	auto beg_time = high_resolution_clock::now();

	for(int32_t i=0;i<N;++i) {
		nb_rows = 0;
		nb_cells = 0;
		for( auto&& row : parser ) {
			++nb_rows;
			for( auto&& cell : row ) {
				++nb_cells;
			}
		}
	}

	auto end_time = high_resolution_clock::now();
	auto time_elapsed = (end_time - beg_time) / N;
	auto time_us = duration_cast<microseconds>( time_elapsed );
	auto time_s = duration_cast<duration<double>>( time_elapsed );

	if( nb_rows == 0 )
		return;

	std::cout
		<< "rows: " << nb_rows
		<< "\ncells: " << nb_cells
		<< "\ncells/row: " << (double)nb_cells/nb_rows
		<< "\ntime: " << time_s.count()
		<< " s\nrate: " << nb_cells / time_us.count()
		<< " cells/us\n";
}

int main( int argc, char** argv ) {

	const char* file = ( argc > 1 ) ? argv[1] : "sample.csv";
	int N = ( argc > 2 ) ? atoi(argv[2]) : 1;

	benchmark( csv::load_file( file ), N );

}


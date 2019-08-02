#include <catch.hpp>
#include <cwcsv/csv.h>

TEST_CASE( "Write char", "[write-char]" ) {

	std::string out;

	auto writer = csv::make_writer( std::back_inserter(out) );

	writer.write_row( "a" );

	REQUIRE( out == "a\n" );
}

TEST_CASE( "Write row", "[write-row]" ) {

	std::string out;

	auto writer = csv::make_writer( std::back_inserter(out) );

	writer.write_row( "a", "b", "c", "d" );

	REQUIRE( out == "a,b,c,d\n" );
}

TEST_CASE( "Write quote", "[write-quote]" ) {

	std::string out;

	auto writer = csv::make_writer( std::back_inserter(out) );

	writer.write_row( "a", "\"", "c", "\"\"d\"\"" );

	REQUIRE( out == "a,\"\"\"\",c,\"\"\"\"\"d\"\"\"\"\"\n" );
}

TEST_CASE( "Write comma", "[write-comma]" ) {

	std::string out;

	auto writer = csv::make_writer( std::back_inserter(out) );

	writer.write_row( "a", ",", "c", ",d,," );

	REQUIRE( out == "a,\",\",c,\",d,,\"\n" );
}

TEST_CASE( "Write newline", "[write-newline]" ) {

	std::string out;

	auto writer = csv::make_writer( std::back_inserter(out) );

	writer.write_row( "a", "\n", "c", "\nd\n\n" );

	REQUIRE( out == "a,\"\n\",c,\"\nd\n\n\"\n" );
}

TEST_CASE( "Write rows", "[write-rows]" ) {

	std::string out;

	auto writer = csv::make_writer( std::back_inserter(out) );

	writer.write_row( "a", "b", "c", "d" );
	writer.write_row( 1, 2, 3, 4 );
	writer.write_row( 5, 6, 7, 8 );

	REQUIRE( out == "a,b,c,d\n1,2,3,4\n5,6,7,8\n" );
}

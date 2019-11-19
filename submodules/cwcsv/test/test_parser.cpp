#include <catch.hpp>
#include <cwcsv/csv.h>

TEST_CASE( "Parse empty string", "[parse-empty]" ) {

	auto& text = "";

	auto parser = csv::make_parser( text );

	REQUIRE( parser.begin() == parser.end() );
}

TEST_CASE( "Parse single char", "[parse-char]" ) {

	auto& text = "a";

	auto parser = csv::make_parser( text );

	auto row = parser.begin();
	auto cell = row.begin();

	REQUIRE( cell.to_string() == "a" );
	REQUIRE( ++cell == row.end() );
	REQUIRE( ++row == parser.end() );
}

TEST_CASE( "Parse single quote", "[parse-quote]" ) {

	auto& text = "\"";

	auto parser = csv::make_parser( text );

	auto row = parser.begin();
	auto cell = row.begin();

	REQUIRE( cell.to_string() == "" );
	REQUIRE( ++cell == row.end() );
	REQUIRE( ++row == parser.end() );
}

TEST_CASE( "Parse single row", "[parse-row]" ) {

	auto& text = "a,b,c,d";

	auto parser = csv::make_parser( text );

	auto row = parser.begin();
	auto cell = row.begin();

	REQUIRE( cell.to_string() == "a" );
	++cell;
	REQUIRE( cell.to_string() == "b" );
	++cell;
	REQUIRE( cell.to_string() == "c" );
	++cell;
	REQUIRE( cell.to_string() == "d" );
	REQUIRE( ++cell == row.end() );
	REQUIRE( ++row == parser.end() );
}

TEST_CASE( "Parse rows", "[parse-rows]" ) {

	auto& text = "a,b,c,d\n1,2,3,4\nx,y,z,w";

	auto parser = csv::make_parser( text );

	auto row = parser.begin();
	auto cell = row.begin();

	REQUIRE( cell.to_string() == "a" );
	++cell;
	REQUIRE( cell.to_string() == "b" );
	++cell;
	REQUIRE( cell.to_string() == "c" );
	++cell;
	REQUIRE( cell.to_string() == "d" );
	REQUIRE( ++cell == row.end() );
	++row;
	cell = row.begin();

	REQUIRE( cell.to_string() == "1" );
	++cell;
	REQUIRE( cell.to_string() == "2" );
	++cell;
	REQUIRE( cell.to_string() == "3" );
	++cell;
	REQUIRE( cell.to_string() == "4" );
	REQUIRE( ++cell == row.end() );
	++row;
	cell = row.begin();

	REQUIRE( cell.to_string() == "x" );
	++cell;
	REQUIRE( cell.to_string() == "y" );
	++cell;
	REQUIRE( cell.to_string() == "z" );
	++cell;
	REQUIRE( cell.to_string() == "w" );
	REQUIRE( ++cell == row.end() );
	REQUIRE( ++row == parser.end() );
}

TEST_CASE( "Parse quotes", "[parse-quotes]" ) {
	
	auto& text = "a,\"b\",\"\"\"c\"\"\",\"d\"";

	auto parser = csv::make_parser( text );

	auto row = parser.begin();
	auto cell = row.begin();

	REQUIRE( cell.to_string() == "a" );
	++cell;
	REQUIRE( cell.to_string() == "b" );
	++cell;
	REQUIRE( cell.to_string() == "\"c\"" );
	++cell;
	REQUIRE( cell.to_string() == "d" );
	REQUIRE( ++cell == row.end() );
	REQUIRE( ++row == parser.end() );
}

TEST_CASE( "Parse separator", "[parse-separator]" ) {

	auto& text = "a,\",,,b\",c,\",d,,,\"";

	auto parser = csv::make_parser( text );

	auto row = parser.begin();
	auto cell = row.begin();

	REQUIRE( cell.to_string() == "a" );
	++cell;
	REQUIRE( cell.to_string() == ",,,b" );
	++cell;
	REQUIRE( cell.to_string() == "c" );
	++cell;
	REQUIRE( cell.to_string() == ",d,,," );
	REQUIRE( ++cell == row.end() );
	REQUIRE( ++row == parser.end() );
}

TEST_CASE( "Parse newline", "[parse-newline]" ) {

	auto& text = "\"\n\n\n\",\"\n\n\"\n\"\n\",\"\n\n\"";

	auto parser = csv::make_parser( text );

	auto row = parser.begin();
	auto cell = row.begin();

	REQUIRE( cell.to_string() == "\n\n\n" );
	++cell;
	REQUIRE( cell.to_string() == "\n\n" );
	REQUIRE( ++cell == row.end() );
	++row;
	cell = row.begin();

	REQUIRE( cell.to_string() == "\n" );
	++cell;
	REQUIRE( cell.to_string() == "\n\n" );
	REQUIRE( ++cell == row.end() );
	REQUIRE( ++row == parser.end() );
}

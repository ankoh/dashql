#ifndef CWCSV_PARSER_H
#define CWCSV_PARSER_H
#include <cstring>
#include "row.h"
#include "misc.h"

namespace csv {

	template<typename It>
	struct parser {
		using row_type = row<It>;
		using iterator = row_type;
		using char_type = typename std::iterator_traits<It>::value_type;

		parser( It data_beg, It data_end, char_type sep, char_type quot, char_type nline ) :
			data_beg(data_beg),
			data_end(data_end),
			separator(sep),
			quote(quot),
			new_line(nline)
		{}

		iterator begin() const {
			auto it = find_first( data_beg, data_end, quote, new_line );
			while( it != data_end && *it == quote ) {
				++it;
				it = find_first( it, data_end, quote );
				if( it == data_end )
					break;
				++it;
				it = find_first( it, data_end, quote, new_line );
			}
			auto row_end = it;
			return iterator( data_beg, row_end, data_end, separator, quote, new_line );
		}

		iterator end() const {
			return iterator( data_end, data_end, data_end, separator, quote, new_line );
		}

	private:
		It data_beg, data_end;
		char_type separator, quote, new_line;
	};
	
	template<typename It>
	parser<It> make_parser( It p1, It p2, Char<It> separator=',', Char<It> quote='\"', Char<It> new_line='\n' ) {
		return parser<It>( p1, p2, separator, quote, new_line );
	}

	template<typename Char>
	parser<
		typename std::basic_string<Char>::const_iterator
	> make_parser( const std::basic_string<Char>& str, Char separator=',', Char quote='\"', Char new_line='\n' ) {
		return parser<
			typename std::basic_string<Char>::const_iterator
		>( str.begin(), str.end(), separator, quote, new_line );
	}

	template<typename Char,size_t N>
	parser<const Char*> make_parser( const Char (&str)[N], Char separator=',', Char quote='\"', Char new_line='\n' ) {
		return parser<const Char*>( &str[0], &str[N-1], separator, quote, new_line );
	}

	template<typename Char>
	parser<const Char*> make_parser( const Char* str, size_t N, Char separator=',', Char quote='\"', Char new_line='\n' ) {
		return parser<const Char*>( str, str + N, separator, quote, new_line );
	}

	/*template<typename T>
	parser<std::istream_iterator<T>> make_parser( std::basic_istream<T>& p, T separator=',', T quote='\"', T new_line='\n' ) {
		auto len = p.tellg();
		auto beg = std::istream_iterator<T>(p);
		p.seekg(0,std::ios::end);
		auto end = std::istream_iterator<T>(p);
		p.clear();
		p.seekg(len);
		return parser<std::istream_iterator<T>>( beg, end, separator, quote, new_line );
	}*/

}

#endif

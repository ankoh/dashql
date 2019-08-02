#ifndef CWCSV_WRITER_H
#define CWCSV_WRITER_H
#include <utility>
#include "misc.h"

namespace csv {

	template<typename It,typename Char = typename std::iterator_traits<It>::value_type>
	struct writer {
		using char_type = Char;
		using string_type = std::basic_string<char_type>;

		writer( It out, char_type sep, char_type quot, char_type nline ) :
			out(out),
			separator(sep),
			quote(quot),
			new_line(nline)
		{}

		template<typename T>
		void write_cell( T&& x ) {
			using csv::to_string;
			using std::to_string;
			auto str = to_string( std::forward<T>(x) );
			bool has_quote = str.find_first_of( quote ) != string_type::npos;
			bool has_separ = str.find_first_of( separator ) != string_type::npos;
			bool has_nline = str.find_first_of( new_line ) != string_type::npos;
			bool quoted = (has_quote || has_separ || has_nline);
			if( quoted ) {
				*out++ = quote;
				if( has_quote ) {
					auto end = str.end();
					for(auto p=str.begin();p!=end;++p) {
						auto val = *p;
						if( val == quote ) {
							*out++ = quote;
						}
						*out++ = val;
					}
				} else {
					out = std::copy( str.begin(), str.end(), out );
				}
				*out++ = quote;
			} else {
				out = std::copy( str.begin(), str.end(), out );
			}
		}

		void write_cell( char_type x ) {
			bool has_quote = x == quote;
			bool has_separ = x == separator;
			bool has_nline = x == new_line;
			bool quoted = ( has_quote || has_separ || has_nline );
			if( quoted ) {
				*out++ = quote;
				if( has_quote ) {
					*out++ = quote;
				}
				*out++ = x;
				*out++ = quote;
			} else {
				*out++ = x;
			}
		}

		template<typename Itr>
		void write_row_range( Itr p1, Itr p2 ) {
			for(;p1!=p2;++p1) {
				write_cell( *p1 );
				if( std::next(p1) != p2 ) {
					*out++ = separator;
				}
			}
			*out++ = new_line;
		}

		template<typename T,typename... Ts>
		void write_row( T&& x, Ts&&... xs ) {
			write_cell( std::forward<T>(x) );
			if( sizeof...(Ts) > 0 )
				*out++ = separator;
			write_row( std::forward<Ts>(xs)... );
		}

		void write_row() {
			*out++ = new_line;
		}

		template<typename T,typename... Ts>
		void write_partial_row( T&& x, Ts&&... xs ) {
			write_cell( std::forward<T>(x) );
			*out++ = separator;
			write_partial_row( std::forward<Ts>(xs)... );
		}

		void write_partial_row() const {}

		void write_row_end() {
			*out++ = new_line;
		}

	private:
		It out;
		char_type separator, quote, new_line;
	};

	template<typename It,typename C=Char<It>>
	writer<It,C> make_writer( It p, C separator=',', C quote='\"', C new_line='\n' ) {
		return writer<It,C>( p, separator, quote, new_line );
	}

	template<typename T>
	writer<std::back_insert_iterator<T>,Val<T>> make_writer( std::back_insert_iterator<T> p, Val<T> separator=',', Val<T> quote='\"', Val<T> new_line='\n' ) {
		return writer<std::back_insert_iterator<T>,Val<T>>( p, separator, quote, new_line );
	}

	template<typename T>
	writer<std::ostream_iterator<T>,T> make_writer( std::basic_ostream<T>& p, T separator=',', T quote='\"', T new_line='\n' ) {
		return writer<std::ostream_iterator<T>,T>( std::ostream_iterator<T>(p), separator, quote, new_line );
	}

}

#endif

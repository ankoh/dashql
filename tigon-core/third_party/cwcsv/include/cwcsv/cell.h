#ifndef CWCSV_CELL_H
#define CWCSV_CELL_H
#include <iterator>
#include <utility>
#include <string>
#include <algorithm>
#include <string_view>

namespace csv {

	template<typename It,typename T>
	It find_first( It beg, It end, const T& value ) {
		for( ; beg != end; ++beg ) {
			if( *beg == value ) {
				break;
			}
		}
		return beg;
	}

	template<typename It,typename T>
	It find_first( It beg, It end, const T& v1, const T& v2 ) {
		for( ; beg != end; ++beg ) {
			auto val = *beg;
			if( val == v1 || val == v2 ) {
				break;
			}
		}
		return beg;
	}

	template<typename It,typename Char>
	It find_cell_begin( It p1, It p2, Char quote ) {
		if( p1 != p2 && *p1 == quote )
			++p1;
		return p1;
	}

	template<typename It,typename Char>
	It find_cell_end( It p1, It p2, Char separator, Char quote ) {
		auto cell_end = p2;
		if( p1 == p2 )
			return cell_end;
		if( *p1 == quote ) {
			++p1;
			if( p1 == p2 ) {
				return cell_end;
			}
			auto it = find_first( p1, p2, quote );
			while( it != p2 ) {
				auto it_next = std::next(it);
				if( *it_next != quote )
					break;
				it = find_first( std::next(it_next), p2, quote );
			}
			cell_end = it;
			return cell_end;
		}
		cell_end = find_first( p1, p2, separator );
		return cell_end;
	}

	template<typename It>
	struct cell {
		using this_type = cell<It>;
		using iterator = It;
		using value_type = this_type;
		using reference = const this_type&;
		using pointer = const this_type*;
		using char_type = typename std::iterator_traits<iterator>::value_type;
		using iterator_category = std::forward_iterator_tag;
		using difference_type = ptrdiff_t;
		using string_type = std::basic_string<char_type>;

		cell( It cell_begin, It cell_end, It row_end, char_type sep, char_type quo ) :
			cell_begin(cell_begin),
			cell_end(cell_end),
			row_end(row_end),
			separator(sep),
			quote(quo)
		{}

		string_type to_string() const {
			string_type output;
			output.reserve( size() );
			bool skip = false;
			for( auto p = cell_begin; p != cell_end; ++p ) {
				if( !skip )
					output.push_back( *p );
				if( *p == quote ) {
					skip = !skip;
				}
			}
			return output;
		}

		double to_double() const {
			string_type str( cell_begin, cell_end );
			return atof( str.c_str() );
		}

		int to_int() const {
			string_type str( cell_begin, cell_end );
			return atoi( str.c_str() );
		}

		long to_long() const {
			string_type str( cell_begin, cell_end );
			return atol( str.c_str() );
		}

		long long to_longlong() const {
			string_type str( cell_begin, cell_end );
			return atoll( str.c_str() );
		}
		
		std::pair<It,It> to_pair() const {
			return std::make_pair(cell_begin,cell_end);
		}
		
		std::basic_string_view<char_type> to_string_view() const {
			return std::basic_string_view<char_type>(cell_begin,std::distance(cell_begin,cell_end));
		}

		iterator begin() const {
			return cell_begin;
		}

		iterator end() const {
			return cell_end;
		}

		size_t size() const {
			return std::distance(cell_begin,cell_end);
		}

		bool empty() const {
			return cell_begin == cell_end;
		}

		bool last() const {
			return cell_end == row_end;
		}

		reference operator*() const {
			return *this;
		}

		pointer operator->() const {
			return this;
		}

		this_type& operator++() {
			cell_begin = cell_end;
			if( cell_end == row_end ) {
				return *this;
			}
			if( *cell_begin == quote ) {
				++cell_begin;
				if( cell_begin == row_end ) {
					cell_end = row_end;
					return *this;
				}
			}
			++cell_begin;
			cell_end = find_cell_end( cell_begin, row_end, separator, quote );
			cell_begin = find_cell_begin( cell_begin, row_end, quote );
			return *this;
		}

		this_type operator++(int) {
			auto temp = *this;
			++(*this);
			return temp;
		}

		bool operator==( const this_type& rhs ) const {
			return cell_begin == rhs.cell_begin && cell_end == rhs.cell_end;
		}

		bool operator!=( const this_type& rhs ) const {
			return !(*this == rhs);
		}

	private:
		It cell_begin, cell_end, row_end;
		char_type separator, quote;
	};

}

#endif

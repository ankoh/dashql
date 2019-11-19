#ifndef CWCSV_ROW_H
#define CWCSV_ROW_H
#include "cell.h"

namespace csv {

	template<typename It>
	struct row {
		using this_type = row<It>;
		using iterator = cell<It>;
		using value_type = this_type;
		using reference = const value_type&;
		using pointer = const value_type*;
		using iterator_category = std::forward_iterator_tag;
		using difference_type = ptrdiff_t;
		using char_type = typename std::iterator_traits<It>::value_type;

		row( It row_begin, It row_end, It data_end, char_type sep, char_type quot, char_type nline ) :
			row_begin(row_begin),
			row_end(row_end),
			data_end(data_end),
			separator(sep),
			quote(quot),
			new_line(nline)
		{}

		iterator begin() const {
			auto cell_end = find_cell_end( row_begin, row_end, separator, quote );
			auto cell_begin = find_cell_begin( row_begin, cell_end, quote );
			return iterator( cell_begin, cell_end, row_end, separator, quote );
		}
		
		iterator end() const {
			return iterator( row_end, row_end, row_end, separator, quote );
		}

		reference operator*() const {
			return *this;
		}
		
		pointer operator->() const {
			return this;
		}

		this_type& operator++() {
			row_begin = row_end;
			if( row_end == data_end )
				return *this;
			++row_begin;
			auto it = find_first( row_begin, data_end, quote, new_line );
			while( it != data_end && *it == quote ) {
				++it;
				it = find_first( it, data_end, quote );
				if( it == data_end )
					break;
				++it;
				it = find_first( it, data_end, quote, new_line );
			}
			row_end = it;
			return *this;
		}

		this_type operator++(int) {
			auto temp = *this;
			++(*this);
			return temp;
		}

		bool operator==( const this_type& rhs ) const {
			return row_begin == rhs.row_begin && row_end == rhs.row_end;
		}

		bool operator!=( const this_type& rhs ) const {
			return !(*this == rhs);
		}

	private:
		It row_begin, row_end, data_end;
		char_type separator, quote, new_line;
	};

}

#endif

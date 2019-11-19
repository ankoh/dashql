#ifndef CWCSV_MISC_H
#define CWCSV_MISC_H
#include <iterator>
#include <string>
#include <fstream>

namespace csv {

	template<typename It>
	using Char = typename std::iterator_traits<It>::value_type;

	template<typename T>
	using Val = typename T::value_type;

	template<typename C,typename T,typename A>
	std::basic_string<C,T,A> to_string( const std::basic_string<C,T,A>& x ) {
		return x;
	}

	template<typename C>
	std::basic_string<C> to_string( const C* x ) {
		return x;
	}

	inline std::string load_file( const char* filename ) {
		std::fstream in( filename );
		if( !in )
			return {};

		in.seekg(0,std::ios::end);
		auto len = in.tellg();
		in.seekg(0,std::ios::beg);

		std::string output( len, '\0' );
		in.read( &output[0], len );
		auto actual_len = in.gcount();
		output.erase( actual_len );
		return output;
	}

}

#endif

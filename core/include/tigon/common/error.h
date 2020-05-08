//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#ifndef INCLUDE_TIGON_INFRA_ERROR_H_
#define INCLUDE_TIGON_INFRA_ERROR_H_

#include <stdexcept>
#include <string>

namespace tigon {

    struct TQLParseError : std::exception {
        // Constructor
        explicit TQLParseError(const char* what): message_(what) {}
        // Constructor
        explicit TQLParseError(const std::string& what): message_(what) {}
        // Destructor
        virtual ~TQLParseError() throw() {}
        // Get error message
        virtual const char* what() const throw() {
            return message_.c_str();
        }

      protected:
        // Error message
        std::string message_;
    };

} // namespace tigon

#endif // INCLUDE_TIGON_INFRA_ERROR_H_

#include "dashql/program_instance.h"

namespace dashql {

/// Constructor
ProgramInstance::ProgramInstance(std::string_view text, const sx::ProgramT& program)
    : program_text_(text), program_(program), parameters_(), patch_() {}

}  // dashql

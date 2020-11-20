#include "dashql/session.h"
#include "dashql/parser/parser_driver.h"
#include "dashql/proto/session_generated.h"

using namespace dashql;
namespace fb = flatbuffers;

namespace dashql {

/// Constructor
Session::Session()
    : database_(), database_connection_(), program_text_(), program_(), action_status_() {
    database_connection_ = database_.Connect();
    program_ = {nullptr, fb::DetachedBuffer()};
}

/// Evaluate a program
ExpectedBufferRef<proto::session::ExecutableProgram> Session::Evaluate(const char* text) {
    std::string_view text_view{text};
    flatbuffers::FlatBufferBuilder builder{text_view.size()};

    // Parse the text
    auto program = parser::ParserDriver::Parse(builder, text_view);

    // Build the executable program
    proto::session::ExecutableProgramBuilder prog_builder{builder};
    prog_builder.add_program(program);
    auto prog_ofs = prog_builder.Finish();

    // Finish the buffer
    builder.Finish(prog_ofs);
    auto prog_ptr = fb::GetRoot<proto::session::ExecutableProgram>(builder.GetBufferPointer());
    program_ = {prog_ptr, builder.Release()};
    return {std::get<1>(program_)};
}

/// Update the action status
void Session::UpdateActionStatus(uint32_t id, proto::action::ActionStatus status) {
}

}

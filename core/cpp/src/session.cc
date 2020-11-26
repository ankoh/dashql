#include "dashql/session.h"

#include "dashql/parser/parser_driver.h"
#include "dashql/proto/session_generated.h"
#include "dashql/proto/syntax_generated.h"

using namespace dashql;
namespace fb = flatbuffers;
namespace sx = proto::syntax;

namespace dashql {

/// Constructor
Session::Session() : database_(), database_connection_(), program_text_(), plan_(), action_status_() {
    database_connection_ = database_.Connect();
    plan_ = {nullptr, fb::DetachedBuffer()};
}

/// Evaluate a program
ExpectedBufferRef<proto::session::Plan> Session::Evaluate(const char* text) {
    std::string_view text_view{text};
    flatbuffers::FlatBufferBuilder builder{text_view.size()};

    // Parse the program
    auto program = parser::ParserDriver::Parse(text_view);
    auto program_ofs = sx::Program::Pack(builder, program.get());

    // Build the plan
    proto::session::PlanBuilder plan_builder{builder};
    plan_builder.add_program(program_ofs);
    auto plan_ofs = plan_builder.Finish();

    // Finish the buffer
    builder.Finish(plan_ofs);
    auto prog_ptr = fb::GetRoot<proto::session::Plan>(builder.GetBufferPointer());
    plan_ = {prog_ptr, builder.Release()};
    return {std::get<1>(plan_)};
}

/// Update the action status
void Session::UpdateActionStatus(uint32_t id, proto::action::ActionStatus status) {}

}  // namespace dashql

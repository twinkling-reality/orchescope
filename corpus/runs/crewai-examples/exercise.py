"""Exercise the pinned marketing crew with bounded runtime source identity.

`openinference-instrumentation-crewai` emits roles but no source coordinates. Roles alone are ambiguous in
this repository because three applications declare the same three. The integration installed below observes
the Python caller that constructs each real Agent, then attaches that identity only when the same object is
executed. It does not read declarations, names, corpus metadata or the working directory as identity.

The crew is the repository's own, and so are the agents, the tasks and the roles they carry. What the driver
supplies is the model and the integration boundary. The source evidence still comes from Python frames and
the clean checkout that owns those frames.

**No provider is reached and no credential is used.** `BaseLLM` is CrewAI's own extension point for a model
that does not go through litellm, so a subclass of it answers from this process. The two tools this crew
declares both search the internet, so the script never calls one, and what that costs is stated in the entry
rather than hidden: this run produces no tool span.

**A task that declares `output_json` is answered with a document rather than with prose.** Three of the five
tasks name a Pydantic model for their output, and CrewAI validates the answer against it, so a scripted model
returning a sentence fails inside the third task with a validation error. The document is derived from the
model the task itself names, so a change to those models changes the answer rather than breaking the run.

**CrewAI's own telemetry is turned off, and that is a change to the program worth naming.** It exports to
`telemetry.crewai.com` from a provider of its own, so it would neither reach this build's receiver nor be
read by it, but it would make a run that is otherwise hermetic reach a third party. `CREWAI_DISABLE_TELEMETRY`
is the library's own documented opt out. `CREWAI_TRACING_ENABLED` is set for a second reason: without it the
first run in a project prompts on standard input for a tracing preference and stores the answer outside the
checkout, so the first run of this entry on a machine would not be the run the next one repeats.

CrewAI keeps per project state of its own outside the checkout, under the platform's application data
directory in a folder named after the working directory, so a run of this entry leaves two small files there.
`CREWAI_STORAGE_DIR` renames that folder and does not move it.

Spans go wherever `OTEL_EXPORTER_OTLP_ENDPOINT` points, which is what `orchescope trace` sets before it runs a
command:

    orchescope --cwd corpus/.cache/crewai-examples-exercised trace -- \
      corpus/.cache/venvs/crewai-examples-exercised/bin/python \
      corpus/runs/crewai-examples/exercise.py corpus/.cache/crewai-examples-exercised

The environment is built by scripts/corpus/exercise.mjs, from the interpreter the entry names: CrewAI declares
`requires-python <3.14`, and pip on a newer one resolves it down to a release from before any of this existed.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

os.environ["CREWAI_DISABLE_TELEMETRY"] = "true"
os.environ["CREWAI_TRACING_ENABLED"] = "false"

CHECKOUT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()
# The integration lives in the tracked harness. An exercise must not leave interpreter cache files in it.
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
sys.path.insert(0, str(CHECKOUT / "crews/marketing_strategy/src"))

from openinference.instrumentation.crewai import CrewAIInstrumentor
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from corpus.instrumentation.crewai_source_identity import install_crewai_source_identity

provider = TracerProvider()
provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
trace.set_tracer_provider(provider)

# Instrumented before the crew is imported, so `Task._execute_core` and `Crew.kickoff` are patched on the
# classes the crew module binds when it imports them. Source capture wraps that installed callable so its
# runtime frame is active when OpenInference starts the span.
CrewAIInstrumentor().instrument(tracer_provider=provider)
install_crewai_source_identity(provider)

from crewai import BaseLLM  # noqa: E402

from marketing_posts.crew import MarketingPostsCrew  # noqa: E402


def document_for(model: type) -> str:
    """The smallest document that validates against a task's declared output model.

    One value per field, chosen from the annotation rather than from a table of field names, so the answer
    follows the repository's models instead of a copy of them held here.
    """
    fields: dict[str, Any] = {}
    for name, field in model.model_fields.items():
        annotation = str(field.annotation)
        if "List" in annotation or "list" in annotation:
            fields[name] = ["one"]
        elif "int" in annotation:
            fields[name] = 1
        elif "float" in annotation:
            fields[name] = 1.0
        else:
            fields[name] = "one"
    return json.dumps(fields)


class ScriptedModel(BaseLLM):
    """A model that answers from this process, so the run repeats span for span.

    Declining function calling is what keeps the two internet search tools this crew declares out of the run:
    CrewAI offers a tool to the model and executes only what the model asks for, and this one asks for none.
    """

    def call(
        self,
        messages: Any,
        tools: Any = None,
        callbacks: Any = None,
        available_functions: Any = None,
        from_task: Any = None,
        from_agent: Any = None,
        response_model: Any = None,
    ) -> str:
        wanted = getattr(from_task, "output_json", None)
        return "A short answer." if wanted is None else document_for(wanted)

    def supports_function_calling(self) -> bool:
        return False

    def supports_stop_words(self) -> bool:
        return False

    def get_context_window_size(self) -> int:
        return 8192


crew = MarketingPostsCrew().crew()
for agent in crew.agents:
    agent.llm = ScriptedModel(model="scripted/echo-1")

crew.kickoff(
    inputs={
        "customer_domain": "crewai.com",
        "project_description": "A one paragraph launch announcement.",
    }
)

# What the run walked, so a corpus log says which roles reached a span rather than only that it exited.
sys.stdout.write(f"roles: {', '.join(agent.role.strip() for agent in crew.agents)}\n")
provider.force_flush()
provider.shutdown()

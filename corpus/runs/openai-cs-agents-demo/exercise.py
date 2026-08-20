"""Exercise the airline agents of the pinned customer service demo so a real run can be joined to the declared graph.

The two entries that carry a run before this one are hermetic: each uses its library's own offline model, so neither
needs a credential and neither costs anything. That is the right property for a corpus entry and it is also the reason
the join has only ever been measured against a model that answers from a schema. This entry is the other case, an
application whose agents hand off to one another, and the handoff is the thing no offline model has exercised.

The OpenAI Agents SDK carries its own tracing, which exports to OpenAI's platform rather than over OTLP, so the spans
this join needs come from the OpenInference instrumentor instead. It emits `openinference.span.kind`, `llm.model_name`
and `tool.name`, which is what `packages/traces/src/attributes.ts` already decodes into `chat`, `embeddings` and
`execute_tool`.

Spans go wherever `OTEL_EXPORTER_OTLP_ENDPOINT` points, which is what `orchescope trace` sets before it runs a command:

    orchescope --cwd corpus/.cache/openai-cs-agents-demo trace -- \
      corpus/.cache/venvs/openai-cs-agents-demo/bin/python corpus/runs/openai-cs-agents-demo/exercise.py

`OPENAI_API_KEY` has to be in the environment and the run reaches the provider, which is what makes this entry
different from the other two and is why it is not part of `--exercise` by default.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from openinference.instrumentation.openai_agents import OpenAIAgentsInstrumentor
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

CHECKOUT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()
sys.path.insert(0, str(CHECKOUT / "python-backend"))

provider = TracerProvider()
provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
trace.set_tracer_provider(provider)

# Instrumented before the SDK is imported, so every agent and tool call is wrapped rather than only the later ones.
OpenAIAgentsInstrumentor().instrument(tracer_provider=provider)

from datetime import datetime  # noqa: E402

from agents import Runner  # noqa: E402
from chatkit.types import ThreadMetadata  # noqa: E402

from airline.agents import triage_agent  # noqa: E402
from airline.context import AirlineAgentChatContext, create_initial_context  # noqa: E402
from airline.demo_data import apply_itinerary_defaults  # noqa: E402
from memory_store import MemoryStore  # noqa: E402


def chat_context() -> AirlineAgentChatContext:
    """The context the demo's own server builds, assembled without the server.

    `AirlineAgentChatContext` is a ChatKit `AgentContext`, so it requires a thread, a store and a request context
    before any agent can run. The demo ships `MemoryStore` for exactly this and its server seeds the state with a
    demo itinerary, which the tools then read; an empty state reaches a tool that has nothing to answer from.
    """
    store = MemoryStore()
    state = create_initial_context()
    apply_itinerary_defaults(state)
    return AirlineAgentChatContext(
        thread=ThreadMetadata(id=store.generate_thread_id({}), created_at=datetime.now()),
        store=store,
        request_context={},
        state=state,
    )


async def main() -> None:
    """One question the triage agent has to hand off to answer.

    A seat change is chosen deliberately over a question triage can answer alone: the declared graph draws handoffs
    out of triage, and a run that never takes one joins to the agent and says nothing about the edges.
    """
    result = await Runner.run(
        triage_agent,
        "I want to change my seat to 14A.",
        context=chat_context(),
    )
    print(result.final_output)


if __name__ == "__main__":
    asyncio.run(main())
    provider.force_flush()
    provider.shutdown()

"""Exercise the pinned deep research graph so a LangGraph run can be joined to the declared graph.

Every OpenInference span this build has ever measured came from one instrumentor, the OpenAI Agents SDK's, and
the rule that decides whether a span reports a component or the instrumentation's own structure was reasoned
against that dialect alone. LangChain and LangGraph are the dialect it has never seen, and they emit `CHAIN`
spans for everything: the graph, every node inside it, every subgraph, every runnable an application composes.
This entry is what measures that rule against them.

`openinference-instrumentation-langchain` is the instrumentor, because LangGraph's own tracing exports to
LangSmith rather than over OTLP. It hangs off LangChain's callback manager, so every node of the compiled graph
becomes a span whatever the application did to build it.

The run is bounded on purpose. The configuration turns clarification off, selects no search API, and holds the
supervisor to one iteration with one research unit and one tool call, so what reaches the provider is a handful
of small completions rather than a research report. What that buys is the whole declared path: the graph enters
at `clarify_with_user`, writes a brief, delegates to the `research_supervisor` subgraph, which delegates again
to the `researcher` subgraph, and hands off to `final_report_generation`, which is the one relation this
repository declares between two of its own nodes.

Spans go wherever `OTEL_EXPORTER_OTLP_ENDPOINT` points, which is what `orchescope trace` sets before it runs a
command:

    orchescope --cwd corpus/.cache/open-deep-research trace -- \
      corpus/.cache/venvs/open-deep-research-exercised/bin/python corpus/runs/open-deep-research/exercise.py

`OPENAI_API_KEY` has to be in the environment and the run reaches the provider, which is why the entry names it
in `requiresEnvironment` and a machine without it is skipped with the reason printed.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from openinference.instrumentation.langchain import LangChainInstrumentor
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

CHECKOUT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()
sys.path.insert(0, str(CHECKOUT / "src"))

provider = TracerProvider()
provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
trace.set_tracer_provider(provider)

# Instrumented before the graph is imported, so the callback manager is patched before any runnable is built.
LangChainInstrumentor().instrument(tracer_provider=provider)

from open_deep_research.deep_researcher import deep_researcher  # noqa: E402

# The smallest configuration that still walks the whole declared path. `search_api: none` leaves the researcher
# with the two tools the application defines itself, so no search credential is needed and no external index is
# reached; the three limits below stop the supervisor loop after a single delegation.
CONFIGURATION = {
    "configurable": {
        "allow_clarification": False,
        "search_api": "none",
        "max_concurrent_research_units": 1,
        "max_researcher_iterations": 2,
        "max_react_tool_calls": 1,
        "research_model": "openai:gpt-4.1-mini",
        "research_model_max_tokens": 4096,
        "compression_model": "openai:gpt-4.1-mini",
        "compression_model_max_tokens": 4096,
        "final_report_model": "openai:gpt-4.1-mini",
        "final_report_model_max_tokens": 4096,
        "summarization_model": "openai:gpt-4.1-mini",
        "summarization_model_max_tokens": 4096,
    }
}


async def main() -> None:
    """One question narrow enough that a single researcher answers it.

    A question needing no search is chosen deliberately: the point of the run is which nodes of the declared
    graph a trace can name, and a question the supervisor splits into several research units multiplies the
    spans without adding a node.
    """
    result = await deep_researcher.ainvoke(
        {"messages": [{"role": "user", "content": "In one paragraph, what is the Model Context Protocol?"}]},
        config=CONFIGURATION,
    )
    print(result.get("final_report", "")[:400])


if __name__ == "__main__":
    asyncio.run(main())
    provider.force_flush()
    provider.shutdown()

"""Exercise one agent of the pinned Pydantic AI checkout so a real run can be joined to the declared graph.

The declared against exercised delta is the centre of this product and it had only ever been shown on the bundled
demonstration, which Orchescope also wrote. This runs third party code instead: the `bank_support` example of the
Pydantic AI repository, at the commit `corpus/corpus.yaml` pins, which declares one agent, one tool and one model.

No provider is called and no credential is needed. `TestModel` is the library's own offline model: it answers from the
tool schemas rather than from a network, and it calls every tool once, which is exactly the run this join needs.

Spans go wherever `OTEL_EXPORTER_OTLP_ENDPOINT` points, which is what `orchescope trace` sets before it runs a command.
Run it through that:

    orchescope --cwd corpus/.cache/pydantic-ai trace -- \
      corpus/.cache/venvs/pydantic-ai/bin/python corpus/runs/pydantic-ai/exercise.py

The environment is built by `scripts/corpus-runtime.mjs`.
"""

from __future__ import annotations

import os
import sqlite3
import sys
from pathlib import Path

# The example names an OpenAI model, and Pydantic AI resolves the provider while the module is being imported, which
# needs a key to be present before `TestModel` can replace anything. A placeholder is forced in rather than defaulted,
# so a real key in the environment cannot be picked up by a corpus run. `ALLOW_MODEL_REQUESTS` is turned off below,
# which makes any attempt to reach a provider raise instead of sending a request.
os.environ["OPENAI_API_KEY"] = "placeholder-no-request-is-made"

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

CHECKOUT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()
sys.path.insert(0, str(CHECKOUT / "examples"))

provider = TracerProvider()
provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
trace.set_tracer_provider(provider)

from pydantic_ai import Agent, models  # noqa: E402
from pydantic_ai.models.test import TestModel  # noqa: E402

models.ALLOW_MODEL_REQUESTS = False

# Instrumentation is opt in per agent, and the example does not opt in, so it is turned on for every agent here.
Agent.instrument_all()

from pydantic_ai_examples import bank_support  # noqa: E402


def main() -> None:
    with sqlite3.connect(":memory:") as connection:
        cursor = connection.cursor()
        cursor.execute("CREATE TABLE customers(id, name, balance)")
        cursor.execute("INSERT INTO customers VALUES (123, 'John', 123.45)")
        connection.commit()

        # The example reads this module global from inside its `__main__` block, so it is set the same way here.
        bank_support.cur = cursor

        dependencies = bank_support.SupportDependencies(
            customer_id=123,
            db=bank_support.DatabaseConn(sqlite_conn=connection),
        )
        with bank_support.support_agent.override(model=TestModel()):
            result = bank_support.support_agent.run_sync(
                "What is my balance?", deps=dependencies
            )
        print(result.output)

    provider.force_flush()
    provider.shutdown()


if __name__ == "__main__":
    main()

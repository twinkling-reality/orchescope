"""Attach runtime-derived source identity to CrewAI agent spans.

The upstream OpenInference wrapper has the actual Agent object but emits only its role. This bounded
integration records the immediate Python frame that constructed that object, then makes the same identity
available while the upstream wrapper starts the later execution span. It never reads the component name,
CrewAI configuration, corpus metadata, or source text to decide the location.
"""

from __future__ import annotations

from collections.abc import Mapping
from contextvars import ContextVar
from dataclasses import dataclass
from functools import wraps
import inspect
from pathlib import Path
import subprocess
from typing import Any
from urllib.parse import urlsplit, urlunsplit
import weakref

from opentelemetry.sdk.trace import ReadableSpan, Span
from opentelemetry.sdk.trace.export import SpanProcessor


MAX_CAPTURED_AGENTS = 256


@dataclass(frozen=True)
class SourceIdentity:
    absolute_file: str
    repository_file: str
    line: int
    function: str
    repository_url: str
    revision: str


_active_identity: ContextVar[SourceIdentity | None] = ContextVar(
    "orchescope_crewai_source_identity", default=None
)


def _git(root: Path, *arguments: str) -> str | None:
    try:
        completed = subprocess.run(
            ["git", "-C", str(root), *arguments],
            check=False,
            capture_output=True,
            text=True,
            timeout=3,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if completed.returncode != 0:
        return None
    output = completed.stdout.strip()
    return output if output else None


def _git_checkout_is_clean(root: Path) -> bool:
    try:
        completed = subprocess.run(
            ["git", "-C", str(root), "status", "--porcelain", "--untracked-files=no"],
            check=False,
            capture_output=True,
            text=True,
            timeout=3,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return completed.returncode == 0 and not completed.stdout.strip()


def _canonical_repository_url(value: str) -> str | None:
    try:
        parsed = urlsplit(value)
        port = "" if parsed.port is None else f":{parsed.port}"
    except ValueError:
        return None
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return None
    if parsed.username is not None or parsed.password is not None:
        return None
    path = parsed.path.rstrip("/")
    if path.endswith(".git"):
        path = path[:-4]
    if not path or path == "/":
        return None
    return urlunsplit((parsed.scheme, f"{parsed.hostname.lower()}{port}", path, "", ""))


def _identity_from_frame(frame: Any) -> SourceIdentity | None:
    filename = frame.f_code.co_filename
    if not filename or (filename.startswith("<") and filename.endswith(">")):
        return None
    source = Path(filename)
    try:
        absolute_file = source.resolve(strict=True)
    except OSError:
        return None
    if not absolute_file.is_file():
        return None

    root_value = _git(absolute_file.parent, "rev-parse", "--show-toplevel")
    if root_value is None:
        return None
    try:
        repository_root = Path(root_value).resolve(strict=True)
        repository_file = absolute_file.relative_to(repository_root).as_posix()
    except (OSError, ValueError):
        return None
    if not repository_file or repository_file.startswith("../"):
        return None
    if _git(repository_root, "ls-files", "--error-unmatch", "--", repository_file) is None:
        return None

    revision = _git(repository_root, "rev-parse", "HEAD")
    if revision is None or len(revision) != 40 or any(c not in "0123456789abcdef" for c in revision):
        return None
    if not _git_checkout_is_clean(repository_root):
        return None
    remote = _git(repository_root, "remote", "get-url", "origin")
    repository_url = None if remote is None else _canonical_repository_url(remote)
    if repository_url is None:
        return None

    return SourceIdentity(
        absolute_file=str(absolute_file),
        repository_file=repository_file,
        line=frame.f_lineno,
        function=frame.f_code.co_qualname,
        repository_url=repository_url,
        revision=revision,
    )


class SourceIdentitySpanProcessor(SpanProcessor):
    def on_start(self, span: Span, parent_context: Any = None) -> None:
        identity = _active_identity.get()
        attributes = getattr(span, "attributes", None)
        if (
            identity is None
            or not isinstance(attributes, Mapping)
            or attributes.get("openinference.span.kind") != "AGENT"
        ):
            return
        span.set_attribute("code.file.path", identity.absolute_file)
        span.set_attribute("code.line.number", identity.line)
        span.set_attribute("code.function.name", identity.function)
        span.set_attribute("vcs.repository.url.full", identity.repository_url)
        span.set_attribute("vcs.ref.head.revision", identity.revision)
        span.set_attribute("orchescope.code.repository.path", identity.repository_file)
        span.set_attribute("orchescope.source.capture", "python.immediate_caller_frame")

    def on_end(self, span: ReadableSpan) -> None:
        return None

    def shutdown(self) -> None:
        return None

    def force_flush(self, timeout_millis: int = 30000) -> bool:
        return True


def install_crewai_source_identity(provider: Any) -> None:
    """Install after OpenInference instruments CrewAI and before importing the target crew."""
    from crewai import Agent, Task

    identities: dict[int, tuple[weakref.ReferenceType[Any], SourceIdentity]] = {}
    original_init = Agent.__init__

    def capture_constructor(instance: Any, *args: Any, **kwargs: Any) -> None:
        current = inspect.currentframe()
        caller = None if current is None else current.f_back
        identity = None if caller is None else _identity_from_frame(caller)
        original_init(instance, *args, **kwargs)
        if identity is not None and len(identities) < MAX_CAPTURED_AGENTS:
            instance_id = id(instance)
            try:
                reference = weakref.ref(
                    instance,
                    lambda _reference, key=instance_id: identities.pop(key, None),
                )
            except TypeError:
                return
            identities[instance_id] = (reference, identity)

    Agent.__init__ = capture_constructor

    instrumented_execute = Task._execute_core

    @wraps(instrumented_execute)
    def expose_identity(
        instance: Any,
        *args: Any,
        **kwargs: Any,
    ) -> Any:
        agent = args[0] if args else kwargs.get("agent")
        captured = None if agent is None else identities.get(id(agent))
        identity = (
            None
            if captured is None or captured[0]() is not agent
            else captured[1]
        )
        token = _active_identity.set(identity)
        try:
            return instrumented_execute(instance, *args, **kwargs)
        finally:
            _active_identity.reset(token)

    Task._execute_core = expose_identity
    provider.add_span_processor(SourceIdentitySpanProcessor())

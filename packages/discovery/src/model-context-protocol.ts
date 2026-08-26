import type { ArgumentFact, CallFact } from '@orchescope/source-analysis';

/**
 * The Model Context Protocol, as far as source can show it.
 *
 * The runtime half recognises this protocol without knowing any library: `recogniseProtocolCall`
 * (`packages/instrumentation/src/json-rpc.ts`) reads `"jsonrpc":"2.0"` and a method name off the wire. The
 * static half cannot do the same thing, and the reason is not a gap in this file. **The specification
 * defines a wire format and no source-level API.** Measured over fifty six pinned repositories, its
 * published method names appear as exact literals in twelve non-test sites in two repositories, and not one
 * of the twenty one server constructions this build recognises carries a protocol-shaped argument:
 * `new McpServer({name, version})` is package metadata. The JSON-RPC frame is assembled inside a dependency
 * the traversal never opens.
 *
 * What source does show is the specification's own vocabulary, spelled in whichever language convention the
 * SDK author preferred, and that is what this file reads. Two derivations, both from the published
 * specification and neither from any vendor:
 *
 * - **A method is a path of words.** `tools/call` is the words `tools` and `call`, and every SDK spells it
 *   in its own convention: `callTool` in JavaScript, `call_tool` in Python. Splitting a callee name into
 *   words and comparing the set is the same generalisation `segmentsOfKey` already makes for argument keys,
 *   and a fifth SDK spelling it `toolsCall` matches with no edit. The word set alone is far too loose:
 *   measured, it names `pydantic-ai`'s own `self._call_tool` a hundred and twenty one times. It is anchored
 *   by the method's own published params, which is what makes it precise: `tools/call` carries
 *   `{name, arguments}` and `_call_tool(tool_call_result)` carries nothing.
 * - **A capability is a noun the specification names.** A server declares `tools`, `resources`, `prompts`,
 *   `logging` and `completions`; a client declares `roots`, `sampling` and `elicitation`. A registration
 *   whose name carries a server capability noun is how every SDK spells serving one.
 *
 * Two further conjuncts were measured and are not here, and their absence is deliberate. The
 * specification's `Tool` object as an anchor on the registration reaches three servers of twenty one, and a
 * transport binding reaches ten; neither adds a site the capability registration does not already reach,
 * and a conjunct that changes no answer is a line nobody can see rot. The transport words are kept only for
 * the one thing they do settle, which is a value with no registration in its own module.
 *
 * One name in this file is not derived, and it is the protocol's own: `mcp`. It is used to recognise a
 * server construction, in conjunction with a registration, because nothing else in the source of a server
 * says which protocol it serves. That is a name list of size one over a name that changes when the protocol
 * is renamed, which is a different decay curve from a list that changes when any vendor ships an SDK, and
 * it is recorded as that rather than as framework blindness. See
 * [ADR 0015](../../../docs/architecture/adr/0015-the-asymmetric-invariant.md).
 */

/** Request methods the specification defines, with the params each one is required to carry. */
const SPEC_METHODS: readonly { readonly method: string; readonly params: readonly string[] }[] = [
  { method: 'tools/call', params: ['name', 'arguments'] },
  { method: 'prompts/get', params: ['name', 'arguments'] },
  { method: 'resources/read', params: ['uri'] },
  { method: 'resources/subscribe', params: ['uri'] },
  { method: 'resources/unsubscribe', params: ['uri'] },
  { method: 'logging/setLevel', params: ['level'] },
  { method: 'sampling/createMessage', params: ['messages'] },
  { method: 'completion/complete', params: ['ref'] },
];

/**
 * Methods whose params the specification leaves optional, so nothing about one call settles what it is.
 *
 * They are recognised only on a receiver an anchored call already settled, which is the same bridge
 * `boundReceivers` uses: what the value was proved to be is what the next call on it is read against.
 */
const UNANCHORED_METHODS: readonly string[] = [
  'tools/list',
  'resources/list',
  'resources/templates/list',
  'prompts/list',
  'roots/list',
];

/** Capabilities a server declares, per the specification's `ServerCapabilities`. */
const SERVER_CAPABILITIES: ReadonlySet<string> = new Set([
  'tool',
  'resource',
  'prompt',
  'logging',
  'completion',
]);

/** Every capability either party declares, which is what an `initialize` handshake carries. */
const ALL_CAPABILITIES: ReadonlySet<string> = new Set([
  ...SERVER_CAPABILITIES,
  'sampling',
  'root',
  'elicitation',
  'experimental',
]);

/** The three transports the specification defines, as the words each one is spelled with. */
const TRANSPORTS: readonly (readonly string[])[] = [
  ['stdio'],
  ['sse'],
  ['streamable', 'http'],
  ['server', 'sent', 'event'],
];

/**
 * The stdio server entry, which is the shape the specification declares a launched server with.
 *
 * All three keys, and only this shape. The HTTP entry the specification also defines is `{url, headers}`,
 * and that is what every HTTP client in every language takes: measured, it fires on `axios`, a pinned
 * negative, at `lib/core/Axios.js:278 mergeConfig` and five more, and on `langgraph` at
 * `libs/langgraph/langgraph/pregel/remote.py:174 get_client`. What makes `{url, headers}` a server entry is
 * the `mcpServers` key it sits under, and reading that key is the configuration half's job. A shape that
 * needs a key to mean anything is not a shape.
 *
 * `{command, args, env}` with all three present is measured at ten entries and zero canaries. Dropping `env`
 * admits a Matter websocket command and a `ClaudeCodeOptions` construction, so the third key is the test.
 */
const STDIO_ENTRY: readonly string[] = ['command', 'args', 'env'];

/**
 * The words a name is made of, singularised, which is how one method reaches every convention that spells it.
 *
 * The same split `segmentsOfKey` makes over an argument key, for the same reason: `callTool`, `call_tool`
 * and `tools/call` are one method written three ways and none of the three is written down.
 */
const wordsOf = (name: string): readonly string[] =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.toLowerCase())
    .map((word) => (word.endsWith('s') && word.length > 3 ? word.slice(0, -1) : word));

const wordKey = (words: readonly string[]): string => [...new Set(words)].sort().join('+');

const ANCHORED_BY_WORDS = new Map(
  SPEC_METHODS.map((entry) => [wordKey(wordsOf(entry.method)), entry]),
);
const UNANCHORED_BY_WORDS = new Set(UNANCHORED_METHODS.map((m) => wordKey(wordsOf(m))));

const objectKeys = (argument: ArgumentFact | undefined): readonly string[] =>
  argument !== undefined && argument.kind === 'object' ? argument.entries.map((e) => e.key) : [];

const allObjectKeys = (call: CallFact): readonly string[] => call.args.flatMap(objectKeys);

/** The specification method a call site is, or nothing, which is the whole of the protocol call test. */
export const anchoredProtocolMethod = (call: CallFact): string | undefined => {
  const last = call.calleePath[call.calleePath.length - 1];
  if (last === undefined || call.calleePath.length < 2) return undefined;
  const entry = ANCHORED_BY_WORDS.get(wordKey(wordsOf(last)));
  if (entry === undefined) return undefined;
  const keys = allObjectKeys(call);
  return entry.params.every((param) => keys.includes(param)) ? entry.method : undefined;
};

/** A method the specification leaves paramless, worth reading only on a receiver already settled. */
export const unanchoredProtocolMethod = (call: CallFact): boolean => {
  const last = call.calleePath[call.calleePath.length - 1];
  if (last === undefined || call.calleePath.length < 2) return false;
  return UNANCHORED_BY_WORDS.has(wordKey(wordsOf(last)));
};

/** The receiver a call was made on, which is what an anchored method settles for the calls after it. */
export const receiverOf = (call: CallFact): string | undefined =>
  call.calleePath.length < 2 ? undefined : call.calleePath.slice(0, -1).join('.');

/** The capability a registration names, per the specification's `ServerCapabilities`. */
export const serverCapabilityNamed = (name: string): string | undefined =>
  wordsOf(name).find((word) => SERVER_CAPABILITIES.has(word));

/** An `initialize` handshake: a `capabilities` object whose own keys are the specification's nouns. */
export const carriesHandshakeCapabilities = (call: CallFact): boolean =>
  call.args.some((argument) => {
    if (argument.kind !== 'object') return false;
    const capabilities = argument.entries.find((entry) => entry.key === 'capabilities');
    if (capabilities === undefined || capabilities.value.kind !== 'object') return false;
    const declared = capabilities.value.entries;
    return (
      declared.length > 0 &&
      declared.every((entry) => {
        const [word] = wordsOf(entry.key);
        return word !== undefined && ALL_CAPABILITIES.has(word);
      })
    );
  });

const namesTransportWords = (words: readonly string[]): boolean =>
  TRANSPORTS.some((transport) => transport.every((word) => words.includes(word)));

/** Whether a symbol is a transport, so a value built from it can be recognised one binding later. */
export const namesTransportSymbol = (symbol: string): boolean =>
  namesTransportWords(wordsOf(symbol));

const covers = (keys: readonly string[], required: readonly string[]): boolean =>
  required.every((key) => keys.includes(key));

/** A server entry written in source rather than in a configuration document, which is the same declaration. */
export const carriesStdioServerEntry = (call: CallFact): boolean =>
  call.args.some((argument) => covers(objectKeys(argument), STDIO_ENTRY));

/**
 * A construction that names the protocol's server role, by the naming convention of both languages.
 *
 * Three conditions and each one is load bearing. The symbol must be type-shaped, because PEP 8 and the
 * JavaScript convention both spell a class with a leading capital and dropping the rule admitted two factory
 * functions. It must carry the protocol's own name or be the bare role noun, because nothing else in a
 * server's source says which protocol it serves. And it must not be the other role, because a client is not
 * a server and reading one as the other invents a component on the repository
 * [ADR 0004](../../../docs/architecture/adr/0004-provenance-not-confidence.md) turns on.
 *
 * The conjunction with a registration is what makes it precise. Measured without one: a hundred and thirty
 * nine sites of `McpError`, `MCP` and `McpCapabilities` against twenty one real servers.
 */
export const namesServerRole = (symbol: string): boolean => {
  if (!/^[A-Z]/.test(symbol)) return false;
  const words = wordsOf(symbol);
  if (words.includes('client')) return false;
  return words.includes('mcp') || (words.length === 1 && words[0] === 'server');
};

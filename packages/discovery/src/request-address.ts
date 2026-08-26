import type { ArgumentFact } from '@orchescope/source-analysis';

/**
 * What a request's address states, and what it declines to state.
 *
 * A repository that builds its URLs writes the host down as often as not, and reading only plain strings
 * turned every one of those into a component named after the function that built it. What separates the
 * addresses this can read from the ones it cannot is not whether they are computed, it is which part of
 * the authority the source settles.
 */

/** The marker a template literal carries in place of each substitution. */
// biome-ignore lint/suspicious/noTemplateCurlyInString: this is the marker the fact model records
export const SUBSTITUTION = '${...}';

/**
 * What stands in a host pattern for a label the address builds at run time.
 *
 * A wildcard, because that is what the source states: any label may appear there. It travels into the
 * component name, so `*.openai.azure.com` says both the part that was read and the part that was not.
 */
const WILDCARD = '*';

/**
 * Whether the address is relative, which means the request has no external host rather than one this
 * build could not read.
 *
 * `fetch("/releases.json")` was reported as `unresolved-host-wireDownload` and explained with "a base
 * address held in a constant is the common cause", about an argument that is a fully visible string
 * literal. There is no host in it because it is a same origin request, and saying a host could not be
 * resolved is a confident answer to a question the source settles plainly.
 *
 * `//host/path` is protocol relative and does carry an authority, so a single leading slash is what
 * separates the two.
 */
export const isSameOrigin = (url: string): boolean => url.startsWith('/') && !url.startsWith('//');

export const hostOf = (url: string): string | undefined => {
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)/i.exec(url);
  return match?.[2];
};

/** The path an address names, which is empty when the address stops at the host. */
export const pathOf = (url: string): string => {
  const afterScheme = url.indexOf('://');
  const slash = url.indexOf('/', afterScheme < 0 ? 0 : afterScheme + 3);
  return slash < 0 ? '' : url.slice(slash);
};

/**
 * The address a request names, from a literal or from the part of a template written before it computes
 * anything.
 *
 * The authority has to be finished before the first substitution. `` `https://api.${region}.example.com/x` ``
 * has a prefix of `https://api.` and reading a host out of that would invent `api.`, which is worse than
 * declining: it is a confident answer to a question the source did not settle. A terminator after the
 * authority is what proves the host is whole.
 *
 * This reads the hosts a repository wrote and not the ones it assembles. `` `${API_BASE}${path}` `` begins
 * with a substitution and states nothing at all here, which is the common shape in a codebase with one
 * configured base URL; following that constant is a separate piece of work and the adapter says how many
 * requests it left unresolved rather than implying it read them.
 */
export const addressOf = (argument: ArgumentFact | undefined): string | undefined => {
  if (argument === undefined) return undefined;
  if (argument.kind === 'string') return argument.value;
  if (argument.kind !== 'template') return undefined;
  if (!argument.hasSubstitutions) return argument.value;
  const prefix = argument.value.slice(0, argument.value.indexOf(SUBSTITUTION));
  /*
   * A relative address has its origin complete before anything is substituted, because there is no
   * origin in it to complete. `` `/api/history?conversation=${id}` `` says as plainly as a literal does
   * that the request does not leave the origin, and declining it left the one shape a template most
   * often takes reported as a host this build could not read.
   */
  if (isSameOrigin(prefix)) return prefix;
  const authority = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]+[/?#]/i.exec(prefix);
  return authority === null ? undefined : prefix;
};

/** The authority a template states, with the marker left wherever it substitutes. */
const authorityTemplateOf = (value: string): string | undefined => {
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(value);
  if (scheme === null) return undefined;
  const rest = value.slice(scheme[0].length);
  const terminator = rest.search(/[/?#]/);
  const authority = terminator < 0 ? rest : rest.slice(0, terminator);
  return authority.length === 0 ? undefined : authority;
};

export type StatedHost = {
  /** The host as the source states it, carrying a wildcard where it substitutes. */
  readonly host: string;
  /** The whole address as written, which still holds its markers and is not a URL anyone can request. */
  readonly url: string;
};

/**
 * A host whose tail the source settles even though its head is built at run time.
 *
 * `` `https://${service}.openai.azure.com` `` states `openai.azure.com` as certainly as a literal does.
 * The rule above is about the head and it is right: nothing here reads a host out of `https://api.`. This
 * is the opposite end of the same address and a separate reading, not a relaxation of that one, because
 * what it takes is the text the source wrote after the last thing it computes.
 *
 * A tail is only worth a name where something knows that tail serves one thing, which is why the caller
 * decides. `example.com` is a tail as complete as any other and naming a service after it would merge
 * every host under a domain into one component, which is the merge this whole reading exists to undo.
 * `openai.azure.com` is a suffix Microsoft owns and serves nothing else from, and
 * `bedrock-runtime.*.amazonaws.com` carries a region rather than a customer; both are already what the
 * endpoint table matches on.
 *
 * The authority must end in text the source wrote. An address ending in a substitution has settled
 * nothing about its tail either, and `` `https://api.openai.${tld}` `` is refused for the reason
 * `https://api.` is.
 */
export const statedHostOf = (
  argument: ArgumentFact | undefined,
  identifiesService: (host: string) => boolean,
): StatedHost | undefined => {
  if (argument?.kind !== 'template' || !argument.hasSubstitutions) return undefined;
  const authority = authorityTemplateOf(argument.value);
  if (authority === undefined || !authority.includes(SUBSTITUTION)) return undefined;
  if (authority.endsWith(SUBSTITUTION)) return undefined;
  const host = authority.split(SUBSTITUTION).join(WILDCARD).toLowerCase();
  return identifiesService(host) ? { host, url: argument.value } : undefined;
};

/**
 * A host pattern rewritten so something that answers about hosts can read it.
 *
 * A wildcard is not a DNS label, so a table matching a regional Bedrock host against
 * `bedrock-runtime.<region>.amazonaws.com` rejects `bedrock-runtime.*.amazonaws.com` on the character
 * rather than on the shape. An ordinary label in that position asks the question the pattern means. A
 * host with no wildcard in it is unchanged, which is every host read whole.
 *
 * The credentials and the port go too, because `hostOf` returns the whole authority and the table
 * answers about hostnames. The two halves of the join disagreed about this: the shim asks with
 * `url.hostname`, which carries neither, so a repository whose source writes
 * `https://api.openai.com:443/v1/chat/completions` was an unrecognised host to the scan and OpenAI to
 * the run, and the delta between them was manufactured here rather than found in the repository. The
 * full authority stays on `details.host`, where it is the name a reader recognises and where
 * `external_service:localhost-11434` comes from.
 *
 * Dropping the credentials also keeps them out of the permission scope and the component name, which is
 * the second reason and would be enough on its own.
 */
export const hostToAskAbout = (host: string): string => {
  const withoutCredentials = host.slice(host.lastIndexOf('@') + 1);
  const closingBracket = withoutCredentials.lastIndexOf(']');
  const portAt = withoutCredentials.indexOf(':', closingBracket + 1);
  const withoutPort = portAt < 0 ? withoutCredentials : withoutCredentials.slice(0, portAt);
  return withoutPort.replaceAll(WILDCARD, 'label');
};

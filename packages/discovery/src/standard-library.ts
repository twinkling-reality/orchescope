import { builtinModules } from 'node:module';

/**
 * Modules a language runtime provides, which are not distributions a repository depends on.
 *
 * The unclaimed-construction reader answers "no adapter claims that distribution" about anything imported
 * that is not local. Without this, `typing`, `asyncio`, `dataclasses` and `json` are distributions nobody
 * claims, and widening the reader by one key reports the standard library as a coverage gap: measured
 * across the pinned corpus, ten hits on `typing`, five on `dataclasses`, three on `asyncio` and one on
 * `json` before any real construction is reached.
 *
 * This is a path-to-owner table in the sense [ADR 0004](../../../docs/architecture/adr/0004-provenance-not-confidence.md)
 * endorses, not a vocabulary of frameworks. It says who owns a name, and the owner is the interpreter. A
 * name here can never be an agent framework, because a language ships its standard library and nobody
 * publishes one.
 *
 * Node's half is asked of the runtime rather than written down. Python's half cannot be, because no Python
 * interpreter is running, so it is the value of `sys.stdlib_module_names` with the private names removed,
 * which is the interpreter's own answer transcribed. It is a closed set per language version and it grows
 * by a handful of names a release; a name missing from it costs one refusal that names a standard-library
 * module, which is a wrong owner rather than a wrong claim about the repository.
 */

/**
 * Top level names `sys.stdlib_module_names` reports, private names excluded.
 *
 * Transcribed rather than written, and held as one string so that it reads as the data it is and so
 * that regenerating it is a replacement rather than a merge.
 */
const PYTHON_STANDARD_LIBRARY: ReadonlySet<string> = new Set(
  (
    'abc annotationlib antigravity argparse array ast asyncio atexit base64 bdb binascii bisect ' +
    'builtins bz2 cProfile calendar cmath cmd code codecs codeop collections colorsys compileall ' +
    'compression concurrent configparser contextlib contextvars copy copyreg csv ctypes curses ' +
    'dataclasses datetime dbm decimal difflib dis doctest email encodings ensurepip enum errno ' +
    'faulthandler fcntl filecmp fileinput fnmatch fractions ftplib functools gc genericpath ' +
    'getopt getpass gettext glob graphlib grp gzip hashlib heapq hmac html http idlelib imaplib ' +
    'importlib inspect io ipaddress itertools json keyword linecache locale logging lzma mailbox ' +
    'marshal math mimetypes mmap modulefinder msvcrt multiprocessing netrc nt ntpath nturl2path ' +
    'numbers opcode operator optparse os pathlib pdb pickle pickletools pkgutil platform ' +
    'plistlib poplib posix posixpath pprint profile pstats pty pwd py_compile pyclbr pydoc ' +
    'pydoc_data pyexpat queue quopri random re readline reprlib resource rlcompleter runpy sched ' +
    'secrets select selectors shelve shlex shutil signal site smtplib socket socketserver ' +
    'sqlite3 sre_compile sre_constants sre_parse ssl stat statistics string stringprep struct ' +
    'subprocess symtable sys sysconfig syslog tabnanny tarfile tempfile termios textwrap this ' +
    'threading time timeit tkinter token tokenize tomllib trace traceback tracemalloc tty turtle ' +
    'turtledemo types typing unicodedata unittest urllib uuid venv warnings wave weakref ' +
    'webbrowser winreg winsound wsgiref xml xmlrpc zipapp zipfile zipimport zlib zoneinfo'
  ).split(' '),
);

/**
 * Node names the runtime itself reports, so a release that adds one needs no edit here.
 *
 * `node:`-prefixed specifiers are already refused by the caller; this catches the bare spelling, which is
 * what a repository that predates the prefix writes.
 */
const NODE_BUILTINS: ReadonlySet<string> = new Set(
  builtinModules.map((name) => name.replace(/^node:/, '')),
);

/**
 * Whether this specifier names a module the language runtime provides.
 *
 * Asked of the top level name, because `os.path` and `node:fs/promises` belong to the module their first
 * segment names. The language decides which table to ask: a Python file importing `path` means a
 * distribution, and a JavaScript file importing `path` means the builtin.
 */
export const namesStandardLibrary = (specifier: string, language: string): boolean => {
  const [root = specifier] = specifier.split(/[./]/, 1);
  if (root.length === 0) return false;
  if (language === 'python') return PYTHON_STANDARD_LIBRARY.has(root);
  return NODE_BUILTINS.has(root);
};

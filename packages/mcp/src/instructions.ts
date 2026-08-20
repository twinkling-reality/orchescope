/**
 * What an agent is told when it connects, before it has called anything.
 *
 * The protocol carries one string for this and the server sent none, so an agent arriving here saw
 * seventeen tool names and no statement of which one to call first. Seventeen is the right number of tools
 * and the wrong number of decisions: the loop is one call and then whatever that call says next, and an
 * agent that cannot see that starts by guessing between `scan_agent_system`, `get_system_map` and
 * `get_findings`, none of which is wrong and none of which is the beginning.
 *
 * It names the entry point and the field that drives the rest, rather than describing a workflow. The
 * workflow is already in the payload: `audit_agent_system` returns where the repository stands in the five
 * step loop and the one next action, with the tool and arguments to call when a tool exists. Restating that
 * here would give an agent two accounts of the loop that could disagree, and the payload is the one derived
 * from the repository.
 *
 * It stays short on purpose. This text is prepended to a context window on every session, and a front door
 * that has to be read is not a front door.
 */
export const SERVER_INSTRUCTIONS = `Orchescope reports the difference between what an agent system's repository declares and what its runs
actually exercised, and turns a difference into a bounded goal whose outcome is verified by rerunning the
same check. It reads the repository it is pointed at, writes only inside that repository, and sends nothing
anywhere.

Call audit_agent_system first. It returns the declared against exercised delta, a bounded page of findings,
and a loop block: five steps, which one this repository is standing at, and the one next action. Where
loop.next.tool is present it names the tool and the arguments to call next, so following it is the whole
workflow. Where it is absent, loop.next.argv is a command a person runs.

The five steps are audit, goal, rerun, measure and did it help. Every other tool answers a narrower question
and is there when you need one.

Report what the evidence says and no more. A finding names the components it is about and how each claim was
established, coverage says what could not be inspected, and a metric carries its sample size. Never present
an inference as an observation, and never report a system as safe.`;

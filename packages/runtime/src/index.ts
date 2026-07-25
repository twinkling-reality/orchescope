/**
 * Runtime observation: the loopback OTLP receiver, supervised process execution, and the fault injecting
 * proxy. Everything that touches a socket or spawns a process lives here.
 */

export {
  type AppliedFault,
  type FaultProxyHandle,
  type FaultProxyOptions,
  proxyCapableFaults,
  startFaultProxy,
} from './fault-proxy.ts';
export {
  type ProcessOutcome,
  type ProcessRequest,
  commandIsAllowed,
  runProcess,
} from './process.ts';
export { type ReceiverHandle, type ReceiverOptions, startReceiver } from './receiver.ts';
export {
  type TraceSessionRequest,
  type TraceSessionResult,
  buildTargetEnv,
  runTracedSession,
} from './session.ts';

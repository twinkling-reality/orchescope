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
  commandIsAllowed,
  type ProcessOutcome,
  type ProcessRequest,
  runProcess,
} from './process.ts';
export { type ReceiverHandle, type ReceiverOptions, startReceiver } from './receiver.ts';
export {
  buildTargetEnv,
  OTEL_EXPORT_VARIABLES,
  type InstrumentationOutcome,
  runTracedSession,
  type TraceSessionRequest,
  type TraceSessionResult,
} from './session.ts';

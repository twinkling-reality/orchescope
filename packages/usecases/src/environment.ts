import { arch, cpus, loadavg, platform, totalmem } from 'node:os';
import type { RunEnvironment } from '@orchescope/schema';

/**
 * Environment capture.
 *
 * Recorded with every run so a benchmark number can be judged rather than merely quoted. Load average is
 * included because a measurement taken on a busy machine is a different measurement, and a reader deserves to
 * know that before comparing two numbers.
 */
export const currentEnvironment = (orchescopeVersion: string): RunEnvironment => {
  const cores = cpus();
  const first = cores[0];
  return {
    orchescopeVersion,
    platform: platform(),
    arch: arch(),
    cpuCount: cores.length,
    ...(first === undefined ? {} : { cpuModel: first.model }),
    totalMemoryBytes: totalmem(),
    runtimeName: 'node',
    runtimeVersion: process.versions.node,
    loadAverage1m: Number((loadavg()[0] ?? 0).toFixed(2)),
  };
};

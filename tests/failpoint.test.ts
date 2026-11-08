import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { failpoint } from '../src/engine/failpoint';

describe('failpoint', () => {
  let originalKill: typeof process.kill;

  beforeEach(() => {
    originalKill = process.kill;
  });

  afterEach(() => {
    process.kill = originalKill;
    delete process.env.FAILPOINTS;
    delete process.env.FAILPOINT_P;
  });

  it('does nothing when FAILPOINTS env is unset', () => {
    const killSpy = vi.fn();
    process.kill = killSpy as any;
    failpoint('after_claim');
    expect(killSpy).not.toHaveBeenCalled();
  });

  it('does nothing when failpoint name is not in the list', () => {
    process.env.FAILPOINTS = 'after_claim,after_effect';
    const killSpy = vi.fn();
    process.kill = killSpy as any;
    failpoint('unknown_failpoint');
    expect(killSpy).not.toHaveBeenCalled();
  });

  it('kills process when name matches and probability is 1', () => {
    process.env.FAILPOINTS = 'after_claim';
    process.env.FAILPOINT_P = '1';
    const killSpy = vi.fn();
    process.kill = killSpy as any;
    failpoint('after_claim');
    expect(killSpy).toHaveBeenCalledWith(process.pid, 'SIGKILL');
  });
});
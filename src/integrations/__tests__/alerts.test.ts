import { describe, expect, it, vi } from 'vitest';

vi.mock('@/storage/kv', () => ({ kv: { getItem: async () => null, setItem: async () => undefined } }));
import { useIntegrations } from '../store';

describe('integration alerts', () => {
  it('raises, replaces and dismisses', () => {
    const s = () => useIntegrations.getState();
    expect(s().alert).toBeNull();
    s().raiseAlert({ service: 'concept2', kind: 'upload-failed', message: 'x' });
    expect(s().alert?.service).toBe('concept2');
    s().raiseAlert({ service: 'concept2', kind: 'reconnect', message: 'y' });
    expect(s().alert?.kind).toBe('reconnect');
    s().dismissAlert();
    expect(s().alert).toBeNull();
  });
});

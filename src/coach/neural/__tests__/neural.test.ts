import { describe, expect, it } from 'vitest';
import { audioKey, fixedPhrases, neuralVoice } from '../bank';

describe('neural voice helpers', () => {
  it('pre-renders only placeholder-free phrases, deduped', () => {
    const lines = fixedPhrases('race');
    expect(lines.length).toBeGreaterThan(20);
    expect(lines.some((l) => l.includes('{'))).toBe(false);
    expect(new Set(lines).size).toBe(lines.length);
  });

  it('keys renderings by voice, speed and text', () => {
    expect(audioKey('bella', 1, 'Go')).toBe(audioKey('bella', 1, 'Go'));
    expect(audioKey('bella', 1, 'Go')).not.toBe(audioKey('jasper', 1, 'Go'));
    expect(audioKey('bella', 1, 'Go')).not.toBe(audioKey('bella', 1.1, 'Go'));
    expect(audioKey('bella', 1, 'Go')).toMatch(/^[\w-]+$/);
  });

  it('falls back to the default voice for unknown ids', () => {
    expect(neuralVoice(null).id).toBe('bella');
    expect(neuralVoice('luna').sid).toBe(3); // nano v0.2: expr-voice-3-f
    expect(neuralVoice('nope').id).toBe('bella');
  });

});

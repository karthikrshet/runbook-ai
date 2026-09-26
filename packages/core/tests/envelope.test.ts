import { describe, expect, it } from 'vitest';
import { ENVELOPE_SCHEMA, envelope, parseEnvelope } from '../src/index.js';

const incident = {
  id: 'INC-001',
  title: 'checkout-api returns 500',
  service: 'checkout-api',
};

describe('parseEnvelope', () => {
  it('round-trips an envelope produced by the server helper', () => {
    const parsed = parseEnvelope(envelope('incident', incident, [{ index: 1, status: 'done' }]));
    expect(parsed).toEqual({
      schema: ENVELOPE_SCHEMA,
      kind: 'incident',
      data: incident,
      progress: [{ index: 1, status: 'done' }],
    });
  });

  it.each([
    ['plain text', 'Tool finished'],
    ['broken JSON', '{"schema":'],
    ['a JSON array', '[1,2,3]'],
    [
      'another schema version',
      JSON.stringify({ schema: 'runbookai/v0', kind: 'incident', data: incident }),
    ],
    [
      'an unknown kind',
      JSON.stringify({ schema: ENVELOPE_SCHEMA, kind: 'approve_everything', data: {} }),
    ],
    [
      'a missing field',
      JSON.stringify({ schema: ENVELOPE_SCHEMA, kind: 'incident', data: { id: 'INC-1' } }),
    ],
  ])('rejects %s', (_name, content) => {
    expect(parseEnvelope(content)).toBeNull();
  });

  it('rejects oversized payloads before parsing them', () => {
    const huge = JSON.stringify({
      schema: ENVELOPE_SCHEMA,
      kind: 'incident',
      data: { ...incident, summary: 'x'.repeat(300_000) },
    });
    expect(parseEnvelope(huge)).toBeNull();
  });

  it('rejects a step progress entry with an unknown status', () => {
    const content = JSON.stringify({
      schema: ENVELOPE_SCHEMA,
      kind: 'incident',
      data: incident,
      progress: [{ index: 1, status: 'approved' }],
    });
    expect(parseEnvelope(content)).toBeNull();
  });
});

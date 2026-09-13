/**
 * Test support: the records and logs every suite here starts from.
 *
 * Not imported by anything the substrate runs. It lives beside the sources rather than
 * under a test directory because the substrate keeps its tests beside its sources, and a
 * builder that drifts from the type it builds is caught by the same typecheck as the rest.
 */
import type { AgentRecord } from './record.js';

/**
 * A complete, valid record. Every field is filled, because a builder that left optional
 * gaps would let a test pass against a record no supervisor would ever produce.
 */
export function aRecord(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: 'agent-1',
    name: 'scout',
    charter: 'Find out what is in the repository and report back.',
    model: {
      provider: 'openrouter',
      baseURL: 'https://openrouter.ai/api/v1',
      model: 'anthropic/claude-opus-5',
      credential: 'MODEL_API_KEY',
    },
    workspace: '/workspace',
    environment: 'jen/agent:latest',
    tools: [],
    credentials: [{ name: 'MODEL_API_KEY', ref: 'env:JEN_MODEL_API_KEY' }],
    parent: null,
    ...overrides,
  };
}

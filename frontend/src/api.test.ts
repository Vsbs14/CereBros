import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  fetchContract,
  fetchJson,
  inspectCapabilities,
  type OpenApiContract,
} from './api';

const baseUrl = 'http://127.0.0.1:8000';

const contract: OpenApiContract = {
  openapi: '3.1.0',
  info: { title: 'NeuroLingo', version: '1.0.0' },
  paths: {
    '/health': {
      get: {
        responses: {
          '200': {
            content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' } } } } },
          },
        },
      },
    },
    '/protocols': {
      post: {
        requestBody: { $ref: '#/components/requestBodies/Protocol' },
        responses: { '201': { $ref: '#/components/responses/Protocol' } },
      },
    },
    '/incomplete': { post: { responses: { '204': { description: 'No content' } } } },
  },
  components: {
    requestBodies: {
      Protocol: { content: { 'application/json': { schema: { $ref: '#/components/schemas/ProtocolInput' } } } },
    },
    responses: {
      Protocol: { content: { 'application/json': { schema: { $ref: '#/components/schemas/ProtocolOutput' } } } },
    },
    schemas: {
      ProtocolInput: { type: 'object', properties: { name: { type: 'string' } } },
      ProtocolOutput: { type: 'object', properties: { id: { type: 'string' } } },
    },
  },
};

afterEach(() => vi.unstubAllGlobals());

describe('fetchContract', () => {
  it('loads and validates the configured OpenAPI document', async () => {
    const mockedFetch = vi.fn().mockResolvedValue(Response.json(contract));
    vi.stubGlobal('fetch', mockedFetch);

    await expect(fetchContract({ baseUrl })).resolves.toEqual(contract);
    expect(mockedFetch).toHaveBeenCalledWith(
      `${baseUrl}/openapi.json`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(mockedFetch.mock.calls[0][1].headers.get('Accept')).toBe('application/json');
  });

  it('rejects a document without usable paths', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ openapi: '3.1.0', info: {}, paths: null })));
    await expect(fetchContract({ baseUrl })).rejects.toMatchObject({
      kind: 'invalid-contract',
      message: expect.stringContaining('paths must be an object'),
    });
  });
});

describe('fetchJson', () => {
  it('reports HTTP errors with the backend detail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(
      { detail: 'Protocol was not found' },
      { status: 404, statusText: 'Not Found' },
    )));

    await expect(fetchJson('/protocols/unknown', {}, { baseUrl })).rejects.toMatchObject({
      kind: 'http',
      status: 404,
      message: expect.stringContaining('Protocol was not found'),
    });
  });

  it('reports network failures without a success-shaped fallback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(fetchJson('/health', {}, { baseUrl })).rejects.toMatchObject({
      kind: 'network',
      message: expect.stringContaining('Could not reach the API'),
    });
  });

  it('reports an empty successful response as invalid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));
    await expect(fetchJson('/health', {}, { baseUrl })).rejects.toMatchObject({ kind: 'invalid-json' });
  });

  it('passes abort signals to fetch and labels cancellation', async () => {
    const controller = new AbortController();
    const mockedFetch = vi.fn().mockImplementation((_url, init) => {
      expect(init.signal).toBe(controller.signal);
      controller.abort();
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    });
    vi.stubGlobal('fetch', mockedFetch);

    await expect(fetchJson('/health', {}, { baseUrl, signal: controller.signal })).rejects.toMatchObject({
      kind: 'aborted',
    });
  });
});

describe('inspectCapabilities', () => {
  it('distinguishes verified, missing, and unverified route contracts', () => {
    expect(inspectCapabilities(contract, [
      { name: 'health', path: '/health', method: 'get' },
      { name: 'create protocol', path: '/protocols', method: 'post' },
      { name: 'unknown', path: '/unknown', method: 'get' },
      { name: 'incomplete', path: '/incomplete', method: 'post' },
    ]).map(({ status }) => status)).toEqual(['verified', 'verified', 'missing', 'unverified']);
  });

  it('requires an exact method and resolvable schemas', () => {
    const result = inspectCapabilities(contract, [
      { name: 'wrong method', path: '/health', method: 'post' },
      { name: 'request missing', path: '/incomplete', method: 'post' },
    ]);
    expect(result[0]).toMatchObject({ status: 'missing', reason: expect.stringContaining('POST /health') });
    expect(result[1]).toMatchObject({ status: 'unverified', reason: expect.stringContaining('request schema') });
  });
});

it('exposes typed API errors', () => {
  const error = new ApiError('http', 'Failed', { status: 503 });
  expect(error).toBeInstanceOf(Error);
  expect(error.status).toBe(503);
});

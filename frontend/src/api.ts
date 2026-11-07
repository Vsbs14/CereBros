/** The backend contract is the source of truth for routes and payloads. */

export type ApiErrorKind =
  | 'network'
  | 'aborted'
  | 'http'
  | 'invalid-json'
  | 'invalid-contract';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly url?: string;

  constructor(
    kind: ApiErrorKind,
    message: string,
    options: { status?: number; url?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'ApiError';
    this.kind = kind;
    this.status = options.status;
    this.url = options.url;
  }
}

type JsonObject = Record<string, unknown>;

export interface OpenApiContract extends JsonObject {
  openapi: string;
  info: JsonObject;
  paths: Record<string, JsonObject>;
}

export interface ApiOptions {
  baseUrl?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
function savedApiUrl(): string | null {
  try {return typeof localStorage === 'undefined' ? null : localStorage.getItem('neurolingo-api-url')} catch {return null}
}
export const API_BASE_URL = savedApiUrl() || env?.VITE_API_URL?.trim() || 'http://127.0.0.1:8000';

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function apiUrl(path: string, baseUrl: string): string {
  try {
    const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    return new URL(path.replace(/^\/+/, ''), base).toString();
  } catch (cause) {
    throw new ApiError('invalid-contract', `Invalid API base URL: ${baseUrl}`, { cause });
  }
}

function responseDetail(value: unknown): string | undefined {
  if (!isObject(value)) return undefined;
  for (const key of ['detail', 'message', 'error', 'title']) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

/** Fetches JSON without treating an HTTP error, empty body, or malformed JSON as success. */
export async function fetchJson<T = unknown>(
  path: string,
  init: RequestInit = {},
  options: ApiOptions = {},
): Promise<T> {
  const url = apiUrl(path, options.baseUrl ?? API_BASE_URL);
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  const headers = new Headers(init.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');

  try {
    response = await fetchImpl(url, {
      ...init,
      signal: options.signal ?? init.signal,
      headers,
    });
  } catch (cause) {
    const aborted = options.signal?.aborted || init.signal?.aborted ||
      (isObject(cause) && cause.name === 'AbortError');
    throw new ApiError(
      aborted ? 'aborted' : 'network',
      aborted ? 'The API request was cancelled.' : `Could not reach the API at ${url}.`,
      { url, cause },
    );
  }

  let body: string;
  try {
    body = await response.text();
  } catch (cause) {
    const aborted = options.signal?.aborted || init.signal?.aborted ||
      (isObject(cause) && cause.name === 'AbortError');
    throw new ApiError(
      aborted ? 'aborted' : 'network',
      aborted ? 'The API request was cancelled.' : `Could not read the API response from ${url}.`,
      { status: response.status, url, cause },
    );
  }
  if (!response.ok) {
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { /* Plain text or empty error response. */ }
    const detail = responseDetail(parsed) ?? body.trim().slice(0, 240);
    const suffix = detail ? `: ${detail}` : '.';
    throw new ApiError(
      'http',
      `API request failed (${response.status} ${response.statusText || 'HTTP error'})${suffix}`,
      { status: response.status, url },
    );
  }

  try {
    if (!body.trim()) throw new Error('Empty response body');
    return JSON.parse(body) as T;
  } catch (cause) {
    throw new ApiError(
      'invalid-json',
      `The API returned an empty or invalid JSON response from ${url}.`,
      { status: response.status, url, cause },
    );
  }
}

function validateContract(value: unknown, url: string): asserts value is OpenApiContract {
  const invalid = (reason: string): never => {
    throw new ApiError('invalid-contract', `Invalid OpenAPI contract at ${url}: ${reason}.`, { url });
  };
  if (!isObject(value)) throw invalid('document must be an object');
  if (typeof value.openapi !== 'string' || !/^3\.\d+\./.test(value.openapi)) {
    throw invalid('expected an OpenAPI 3.x version');
  }
  if (!isObject(value.info)) throw invalid('info must be an object');
  if (!isObject(value.paths)) throw invalid('paths must be an object');
  for (const [path, item] of Object.entries(value.paths)) {
    if (!path.startsWith('/')) throw invalid(`path ${JSON.stringify(path)} must start with /`);
    if (!isObject(item)) throw invalid(`path ${path} must be an object`);
    for (const method of HTTP_METHODS) {
      if (!(method in item)) continue;
      const operation = item[method];
      if (!isObject(operation) || !isObject(operation.responses)) {
        throw invalid(`${method.toUpperCase()} ${path} must declare responses`);
      }
    }
  }
}

export async function fetchContract(options: ApiOptions = {}): Promise<OpenApiContract> {
  const baseUrl = options.baseUrl ?? API_BASE_URL;
  const url = apiUrl('/openapi.json', baseUrl);
  const document = await fetchJson('/openapi.json', { method: 'GET' }, options);
  validateContract(document, url);
  return document;
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export interface RouteRequirement {
  name: string;
  path: string;
  method: HttpMethod;
  /** Defaults to true for POST, PUT, and PATCH. */
  requiresRequestSchema?: boolean;
  /** Defaults to true. */
  requiresResponseSchema?: boolean;
}

export interface CapabilityInspection extends RouteRequirement {
  status: 'verified' | 'missing' | 'unverified';
  reason: string;
}

function resolveReference(value: unknown, document: OpenApiContract): unknown {
  if (!isObject(value) || typeof value.$ref !== 'string') return value;
  const ref = value.$ref;
  if (!ref.startsWith('#/')) return undefined;
  let current: unknown = document;
  for (const token of ref.slice(2).split('/')) {
    const key = token.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!isObject(current)) return undefined;
    current = current[key];
  }
  return current;
}

function hasJsonSchema(content: unknown, document: OpenApiContract): boolean {
  if (!isObject(content)) return false;
  const media = content['application/json'] ??
    Object.entries(content).find(([type]) => type.endsWith('+json'))?.[1];
  const resolved = resolveReference(media, document);
  if (!isObject(resolved)) return false;
  const schema = resolveReference(resolved.schema, document);
  return isObject(schema) && Object.keys(schema).length > 0;
}

function hasRequestSchema(operation: JsonObject, document: OpenApiContract): boolean {
  const body = resolveReference(operation.requestBody, document);
  return isObject(body) && hasJsonSchema(body.content, document);
}

function hasResponseSchema(operation: JsonObject, document: OpenApiContract): boolean {
  if (!isObject(operation.responses)) return false;
  return Object.entries(operation.responses).some(([status, raw]) => {
    if (!/^2\d\d$/.test(status) && !/^2XX$/i.test(status)) return false;
    const response = resolveReference(raw, document);
    return isObject(response) && hasJsonSchema(response.content, document);
  });
}

/** An exact path/method is usable only after its required JSON schemas appear in OpenAPI. */
export function inspectCapabilities(
  contract: OpenApiContract,
  requirements: readonly RouteRequirement[],
): CapabilityInspection[] {
  return requirements.map((requirement) => {
    const pathItem = contract.paths[requirement.path];
    if (!pathItem) {
      return { ...requirement, status: 'missing', reason: `No ${requirement.path} path in OpenAPI.` };
    }
    const resolvedPath = resolveReference(pathItem, contract);
    const operation = isObject(resolvedPath) ? resolvedPath[requirement.method] : undefined;
    if (!isObject(operation)) {
      return {
        ...requirement,
        status: 'missing',
        reason: `No ${requirement.method.toUpperCase()} ${requirement.path} operation in OpenAPI.`,
      };
    }
    const needsRequest = requirement.requiresRequestSchema ??
      ['post', 'put', 'patch'].includes(requirement.method);
    if (needsRequest && !hasRequestSchema(operation, contract)) {
      return {
        ...requirement,
        status: 'unverified',
        reason: `${requirement.method.toUpperCase()} ${requirement.path} has no resolvable JSON request schema.`,
      };
    }
    if ((requirement.requiresResponseSchema ?? true) && !hasResponseSchema(operation, contract)) {
      return {
        ...requirement,
        status: 'unverified',
        reason: `${requirement.method.toUpperCase()} ${requirement.path} has no resolvable 2xx JSON response schema.`,
      };
    }
    return {
      ...requirement,
      status: 'verified',
      reason: `${requirement.method.toUpperCase()} ${requirement.path} is declared with the required schemas.`,
    };
  });
}

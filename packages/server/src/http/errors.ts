// ── [PCODE-86 | S15 | v0.1.0] Write the HTTP server on Node built-ins: router, validation, error model, OpenAPI ──
// ── [PCODE-115 | S15 | v0.1.0] Add settings and user management: profile, password, tokens, members, invitations, project settings ──
// ── [PCODE-123 | S15 | v0.1.0] Add the ideas inbox and the AI owner interview ──
//    Why:  one error shape for every failure, so every client (web, VS Code, CLI, mobile) handles errors
//          with one code path: { error: { code, message, details?, requestId } }.
import type { Issue } from './schema.js';

export type ErrorCode =
  | 'invalid_json'
  | 'invalid_request'
  | 'unsupported_media_type'
  | 'payload_too_large'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'method_not_allowed'
  | 'conflict'
  // [PCODE-115 | S15 | v0.1.0] a link that was used, withdrawn or has expired
  | 'gone'
  | 'too_many_requests'
  // [PCODE-123 | S15 | v0.1.0] an outside service (the model provider) failed
  | 'bad_gateway'
  // [PCODE-182 | S15 | v0.1.0] the workspace needs two-step sign-in for this role
  | 'second_factor_required'
  | 'internal';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: Issue[],
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface ErrorBody {
  error: { code: ErrorCode; message: string; details?: Issue[]; requestId: string };
}

export function errorBody(err: HttpError, requestId: string): ErrorBody {
  return {
    error: {
      code: err.code,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
      requestId,
    },
  };
}

export const notFound = (what: string): HttpError =>
  new HttpError(404, 'not_found', what + ' not found');
export const invalid = (details: Issue[]): HttpError =>
  new HttpError(400, 'invalid_request', 'The request is not valid', details);

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ZodValidationException } from 'nestjs-zod';
import { DomainException } from '../errors/exceptions';
import { ErrorCodes } from '../errors/error-codes';
import { RequestContextService } from '../context/request-context';

/** Map a raw HTTP status (from a framework HttpException) to a stable error code. */
function httpStatusToErrorCode(status: number): string {
  switch (status) {
    case 400:
      return ErrorCodes.BAD_REQUEST;
    case 401:
      return ErrorCodes.UNAUTHORIZED;
    case 403:
      return ErrorCodes.FORBIDDEN;
    case 404:
      return ErrorCodes.NOT_FOUND;
    case 405:
      return ErrorCodes.METHOD_NOT_ALLOWED;
    case 409:
      return ErrorCodes.CONFLICT;
    case 413:
      return ErrorCodes.PAYLOAD_TOO_LARGE;
    case 415:
      return ErrorCodes.UNSUPPORTED_MEDIA_TYPE;
    case 422:
      return ErrorCodes.VALIDATION_FAILED;
    case 429:
      return ErrorCodes.RATE_LIMITED;
    default:
      return ErrorCodes.INTERNAL_ERROR;
  }
}

/**
 * Global exception filter — maps every thrown error to one stable wire envelope:
 * { error: { code, message, details, correlationId, traceId } }
 *
 * code is the FE contract — machine-readable, switches on code not message.
 * Internal error details (stack, SQL) never leak to the wire.
 */
@Catch()
@Injectable()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  constructor(private readonly ctx: RequestContextService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const reply = http.getResponse<FastifyReply>();
    const correlationId = this.ctx.getCorrelationId() ?? 'unknown';

    // Zod validation error → 422 + field-level details
    if (exception instanceof ZodValidationException) {
      void reply.status(422).send({
        error: {
          code: ErrorCodes.VALIDATION_FAILED,
          message: 'Validation failed',
          details: (exception.getZodError() as import('zod').ZodError).issues,
          correlationId,
        },
      });
      return;
    }

    // Domain / application errors (typed, expected)
    if (exception instanceof DomainException) {
      void reply.status(exception.httpStatus).send({
        error: {
          code: exception.code,
          message: exception.message,
          details: exception.details ?? [],
          correlationId,
        },
      });
      return;
    }

    // NestJS HttpException (guards, pipes, etc.)
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      void reply.status(status).send({
        error: {
          code: httpStatusToErrorCode(status),
          message:
            typeof res === 'string'
              ? res
              : (((res as Record<string, unknown>)['message'] as string) ?? 'Error'),
          details: [],
          correlationId,
        },
      });
      return;
    }

    // Unhandled — log full detail server-side, return safe shape
    this.logger.error({ correlationId, err: exception }, 'Unhandled exception');
    void reply.status(500).send({
      error: {
        code: ErrorCodes.INTERNAL_ERROR,
        message: 'An unexpected error occurred',
        details: [],
        correlationId,
      },
    });
  }
}

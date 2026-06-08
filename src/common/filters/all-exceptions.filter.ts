import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import * as Sentry from "@sentry/nestjs";
import { ZodError } from "zod";
import type { Response } from "express";

type ErrorBody = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof ZodError) {
      res.status(HttpStatus.BAD_REQUEST).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          details: exception.issues,
        },
      } satisfies ErrorBody);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const { code, message, details } = this.mapHttpException(status, response);
      // Lapor ke Sentry HANYA error server (5xx); 4xx (validasi/auth/not-found)
      // adalah perilaku normal, jangan dijadikan noise.
      if (status >= 500) Sentry.captureException(exception);
      res.status(status).json({
        error: { code, message, ...(details !== undefined ? { details } : {}) },
      } satisfies ErrorBody);
      return;
    }

    // Error tak terduga (bukan HttpException/ZodError) → 500 + lapor Sentry.
    const err = exception as Error | undefined;
    this.logger.error(err?.stack ?? String(exception));
    Sentry.captureException(exception);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      },
    } satisfies ErrorBody);
  }

  private mapHttpException(
    status: number,
    response: string | object,
  ): { code: string; message: string; details?: unknown } {
    const code = this.codeFromStatus(status);
    if (typeof response === "string") {
      return { code, message: response };
    }
    const body = response as { message?: string | string[]; error?: string; details?: unknown };
    const message = Array.isArray(body.message) ? body.message.join("; ") : body.message ?? body.error ?? "Error";
    return { code, message, details: body.details };
  }

  private codeFromStatus(status: number): string {
    switch (status) {
      case 400: return "BAD_REQUEST";
      case 401: return "UNAUTHORIZED";
      case 403: return "FORBIDDEN";
      case 404: return "NOT_FOUND";
      case 409: return "CONFLICT";
      case 422: return "UNPROCESSABLE";
      case 429: return "TOO_MANY_REQUESTS";
      default: return status >= 500 ? "SERVER_ERROR" : "ERROR";
    }
  }
}

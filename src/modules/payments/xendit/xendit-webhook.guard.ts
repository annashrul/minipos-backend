import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * Verify header `x-callback-token` cocok dengan `XENDIT_WEBHOOK_TOKEN` yang
 * sama-sama Anda set di Xendit Dashboard. Ini cara Xendit memastikan bahwa
 * webhook benar-benar dari mereka.
 *
 * Doc: https://developers.xendit.co/api-reference/#callback-token
 */
@Injectable()
export class XenditWebhookGuard implements CanActivate {
  private readonly logger = new Logger(XenditWebhookGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const expected = this.config.get<string>("XENDIT_WEBHOOK_TOKEN");
    if (!expected) {
      this.logger.error(
        "XENDIT_WEBHOOK_TOKEN not configured — refusing webhook",
      );
      throw new UnauthorizedException("Webhook token not configured");
    }
    const req = ctx.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const got =
      (req.headers["x-callback-token"] as string | undefined) ??
      (req.headers["X-Callback-Token"] as unknown as string | undefined);
    if (!got || got !== expected) {
      this.logger.warn(
        `Xendit webhook token mismatch (got=${got ? "***" : "missing"})`,
      );
      throw new UnauthorizedException("Invalid callback token");
    }
    return true;
  }
}

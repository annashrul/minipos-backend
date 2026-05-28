import { Controller, Get, Res } from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import type { Response } from "express";
import { Public } from "@/modules/auth/public.decorator";
import { RealtimeService } from "./realtime.service";

@ApiTags("Realtime Events")
@ApiBearerAuth()
@Controller("events")
export class RealtimeController {
  constructor(private readonly realtime: RealtimeService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: "Server-sent events stream" })
  stream(@Res() res: Response): void {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    res.write(`data: ${JSON.stringify({ event: "connected", data: {} })}\n\n`);

    const unregister = this.realtime.registerSseClient(res);
    const keepAlive = setInterval(() => {
      try {
        res.write(": keep-alive\n\n");
      } catch {
        clearInterval(keepAlive);
        unregister();
      }
    }, 25_000);

    res.on("close", () => {
      clearInterval(keepAlive);
      unregister();
      res.end();
    });
  }
}

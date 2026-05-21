import { Controller, Get, Res } from "@nestjs/common";
import type { Response } from "express";
import { Public } from "../auth/public.decorator";
import { RealtimeService } from "./realtime.service";

@Controller("events")
export class RealtimeController {
  constructor(private readonly realtime: RealtimeService) {}

  @Public()
  @Get()
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

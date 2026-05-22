import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Server, Socket } from "socket.io";

type JwtPayload = {
  sub: string;
  role?: string;
  companyId?: string;
  branchId?: string;
};

// Socket.IO gateway untuk push event ke frontend.
// Auth: handshake `auth.token` = JWT user (sama dengan REST Bearer).
// Setelah verify, socket join 2 room:
//   1. company:<id>  — semua user di company sama
//   2. user:<id>     — per-user kalau ada event personal
//
// Path: namespace `/events`. Frontend connect ke
// `${API_BASE}/events` dengan auth.token = JWT.
@WebSocketGateway({
  namespace: "/events",
  cors: { origin: true, credentials: true },
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly jwt: JwtService) {}

  handleConnection(socket: Socket): void {
    const token = extractToken(socket);
    if (!token) {
      socket.emit("error", { message: "JWT missing" });
      socket.disconnect(true);
      return;
    }
    try {
      const payload = this.jwt.verify<JwtPayload>(token);
      socket.data.userId = payload.sub;
      socket.data.companyId = payload.companyId;
      socket.data.role = payload.role;
      if (payload.companyId) {
        void socket.join(`company:${payload.companyId}`);
      }
      void socket.join(`user:${payload.sub}`);
      socket.emit("connected", {
        userId: payload.sub,
        companyId: payload.companyId,
      });
      this.logger.log(
        `Socket connected user=${payload.sub} company=${payload.companyId ?? "-"} sid=${socket.id}`,
      );
    } catch (err) {
      socket.emit("error", { message: "JWT invalid" });
      this.logger.warn(
        `Socket auth gagal sid=${socket.id}: ${(err as Error).message}`,
      );
      socket.disconnect(true);
    }
  }

  handleDisconnect(socket: Socket): void {
    const u = socket.data?.userId as string | undefined;
    if (u) this.logger.log(`Socket disconnect user=${u} sid=${socket.id}`);
  }

  // ─── Broadcast API ──────────────────────────────────────────────
  // Emit ke SEMUA subscriber (mirror Pusher channel "pos-events" flat).
  // Caller boleh kasih { companyId } supaya scope ke room company tertentu.
  emit(event: string, data: Record<string, unknown>): void {
    const companyId =
      typeof (data as { companyId?: unknown }).companyId === "string"
        ? ((data as { companyId: string }).companyId)
        : undefined;
    if (companyId) {
      this.server.to(`company:${companyId}`).emit(event, data);
    } else {
      // Broadcast global — untuk event yang tidak punya company scope
      // (mis. dashboard refresh, subscription updated, dll)
      this.server.emit(event, data);
    }
  }
}

function extractToken(socket: Socket): string | null {
  const auth = socket.handshake.auth as { token?: string } | undefined;
  if (auth?.token) return String(auth.token).trim();
  const q = socket.handshake.query?.token;
  if (typeof q === "string") return q.trim();
  const h = socket.handshake.headers?.authorization;
  if (typeof h === "string" && h.toLowerCase().startsWith("bearer ")) {
    return h.slice(7).trim();
  }
  return null;
}

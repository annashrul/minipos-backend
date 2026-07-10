import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { io, type Socket } from "socket.io-client";
import { PrismaService } from "@/modules/prisma/prisma.service";
import type {
  WaServiceInboundEvent,
  WaServiceSession,
} from "@/common/wa-service/wa-service.types";

type ConnectionInfo = {
  companyId: string;
  tenantId: string;
  socket: Socket;
};

type SessionHandler = (
  tenantId: string,
  data: WaServiceSession,
) => void | Promise<void>;
type InboundHandler = (
  tenantId: string,
  data: WaServiceInboundEvent,
) => void | Promise<void>;
type TenantDeletedHandler = (tenantId: string) => void | Promise<void>;

// Subscribe ke event push dari wa-service via Socket.IO (namespace /realtime).
// 1 connection per company (yang punya credentials). Auto-reconnect built-in
// dari socket.io-client.
//
// Pakai handler registry (bukan inject ReceiptService langsung) supaya tidak
// terjadi ES module circular import — yang sebelumnya bikin
// "Cannot access 'WhatsappReceiptService' before initialization" saat
// nodemon load file.
//
// ReceiptService.onModuleInit panggil onSessionUpdated/onInboundMessage
// untuk register. Service ini tidak peduli siapa yang handle.
@Injectable()
export class WaServiceSocketService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WaServiceSocketService.name);
  private readonly connections = new Map<string, ConnectionInfo>();
  private readonly sessionHandlers: SessionHandler[] = [];
  private readonly inboundHandlers: InboundHandler[] = [];
  private readonly tenantDeletedHandlers: TenantDeletedHandler[] = [];

  constructor(private readonly prisma: PrismaService) {}

  // ─── Handler registry (dipanggil ReceiptService di onModuleInit) ─
  onSessionUpdated(h: SessionHandler): void {
    this.sessionHandlers.push(h);
  }
  onInboundMessage(h: InboundHandler): void {
    this.inboundHandlers.push(h);
  }
  onTenantDeleted(h: TenantDeletedHandler): void {
    this.tenantDeletedHandlers.push(h);
  }

  // ─── Lifecycle ──────────────────────────────────────────────────
  async onModuleInit(): Promise<void> {
    // Defer 1 tick supaya providers lain (ReceiptService) sempat register
    // handler via onSessionUpdated/onInboundMessage sebelum koneksi
    // benar-benar open + receive event pertama.
    setImmediate(() => {
      this.openAllConnections().catch((err: unknown) => {
        this.logger.error(
          `WaServiceSocket openAllConnections gagal: ${(err as Error).message ?? err}`,
        );
      });
    });
  }

  onModuleDestroy(): void {
    for (const info of this.connections.values()) {
      info.socket.disconnect();
    }
    this.connections.clear();
  }

  private async openAllConnections(): Promise<void> {
    const rows = await this.prisma.whatsappSession.findMany({
      where: {
        AND: [
          { waServiceTenantId: { not: null } },
          { waServiceApiKey: { not: null } },
        ],
      },
      select: {
        companyId: true,
        waServiceTenantId: true,
        waServiceApiKey: true,
      },
    });
    for (const r of rows) {
      this.connectInternal(
        r.companyId,
        r.waServiceTenantId!,
        r.waServiceApiKey!,
      );
    }
    this.logger.log(`WaServiceSocket init: ${rows.length} koneksi tenant siap`);
  }

  // ─── Public mutations ───────────────────────────────────────────
  connectTenant(companyId: string, tenantId: string, apiKey: string): void {
    this.disconnectTenant(companyId);
    this.connectInternal(companyId, tenantId, apiKey);
  }

  disconnectTenant(companyId: string): void {
    const existing = this.connections.get(companyId);
    if (!existing) return;
    existing.socket.disconnect();
    this.connections.delete(companyId);
    this.logger.log(
      `Socket disconnected untuk company=${companyId} tenant=${existing.tenantId}`,
    );
  }

  // ─── Internal connect ───────────────────────────────────────────
  private connectInternal(
    companyId: string,
    tenantId: string,
    apiKey: string,
  ): void {
    const baseUrl = (process.env.WA_SERVICE_URL ?? "").replace(/\/$/, "");
    if (!baseUrl) {
      this.logger.warn(
        `WA_SERVICE_URL belum di-set; skip socket connect untuk company=${companyId}`,
      );
      return;
    }
    const socket = io(`${baseUrl}/realtime`, {
      auth: { token: apiKey },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 15_000,
    });

    socket.on("connect", () => {
      this.logger.log(
        `Socket connected company=${companyId} tenant=${tenantId} sid=${socket.id}`,
      );
    });

    socket.on(
      "connected",
      (info: { tenantId?: string; tenantName?: string }) => {
        this.logger.log(
          `Authenticated by wa-service: ${info.tenantName ?? "?"} (${info.tenantId ?? "?"})`,
        );
      },
    );

    socket.on("session.updated", async (data: WaServiceSession) => {
      for (const h of this.sessionHandlers) {
        try {
          await h(tenantId, data);
        } catch (err) {
          this.logger.error(
            `sessionHandler error company=${companyId}: ${(err as Error).message}`,
          );
        }
      }
    });

    socket.on("message.inbound", async (data: WaServiceInboundEvent) => {
      for (const h of this.inboundHandlers) {
        try {
          await h(tenantId, data);
        } catch (err) {
          this.logger.error(
            `inboundHandler error company=${companyId}: ${(err as Error).message}`,
          );
        }
      }
    });

    socket.on("tenant.deleted", async () => {
      this.logger.warn(
        `Tenant ${tenantId} di-delete dari wa-service — auto-clear credentials company=${companyId}`,
      );
      // Disable auto-reconnect supaya tidak retry connect ke tenant yang
      // sudah tidak ada (server akan tolak 401).
      socket.io.opts.reconnection = false;
      socket.disconnect();
      this.connections.delete(companyId);
      for (const h of this.tenantDeletedHandlers) {
        try {
          await h(tenantId);
        } catch (err) {
          this.logger.error(
            `tenantDeletedHandler error company=${companyId}: ${(err as Error).message}`,
          );
        }
      }
    });

    socket.on("error", (err: unknown) => {
      this.logger.warn(
        `Socket server error company=${companyId}: ${JSON.stringify(err)}`,
      );
    });

    socket.on("connect_error", (err: Error) => {
      this.logger.warn(
        `Socket connect_error company=${companyId}: ${err.message}`,
      );
    });

    socket.on("disconnect", (reason: string) => {
      this.logger.log(
        `Socket disconnect company=${companyId} reason=${reason}`,
      );
    });

    this.connections.set(companyId, { companyId, tenantId, socket });
  }
}

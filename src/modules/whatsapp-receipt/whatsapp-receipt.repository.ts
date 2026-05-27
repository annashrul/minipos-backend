import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

// ─── SELECT constants ────────────────────────────────────────────────

const SESSION_CREDENTIALS_SELECT = {
  waServiceTenantId: true,
  waServiceApiKey: true,
  waServiceWebhookSecret: true,
} satisfies Prisma.WhatsappSessionSelect;

const SESSION_SNAPSHOT_SELECT = {
  status: true,
  stage: true,
  phoneNumber: true,
  deviceName: true,
  qrCode: true,
  lastConnectedAt: true,
  lastDisconnectedAt: true,
  lastError: true,
} satisfies Prisma.WhatsappSessionSelect;

const TRANSACTION_RECEIPT_INCLUDE = {
  items: { orderBy: { createdAt: "asc" as const } },
  payments: { orderBy: { createdAt: "asc" as const } },
  user: { select: { name: true } },
  customer: { select: { name: true, phone: true, memberLevel: true } },
  branch: { select: { name: true } },
} satisfies Prisma.TransactionInclude;

const SESSION_META_SELECT = {
  companyId: true,
  phoneNumber: true,
  deviceName: true,
  status: true,
  company: { select: { name: true } },
} satisfies Prisma.WhatsappSessionSelect;

// ─── Raw types ───────────────────────────────────────────────────────

export type RawSessionCredentials = Prisma.WhatsappSessionGetPayload<{
  select: typeof SESSION_CREDENTIALS_SELECT;
}>;

export type RawSessionSnapshot = Prisma.WhatsappSessionGetPayload<{
  select: typeof SESSION_SNAPSHOT_SELECT;
}>;

export type RawTransactionReceipt = Prisma.TransactionGetPayload<{
  include: typeof TRANSACTION_RECEIPT_INCLUDE;
}>;

export type RawSessionMeta = Prisma.WhatsappSessionGetPayload<{
  select: typeof SESSION_META_SELECT;
}>;

// ─── Repository ──────────────────────────────────────────────────────

@Injectable()
export class WhatsappReceiptRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Session CRUD ────────────────────────────────────────────────

  findSessionByCompany(
    companyId: string,
  ): Promise<{ id: true } & RawSessionCredentials | null> {
    return this.prisma.whatsappSession.findUnique({
      where: { companyId },
      select: { id: true, ...SESSION_CREDENTIALS_SELECT },
    }) as Promise<{ id: true } & RawSessionCredentials | null>;
  }

  findSessionCredentials(
    companyId: string,
  ): Promise<RawSessionCredentials | null> {
    return this.prisma.whatsappSession.findUnique({
      where: { companyId },
      select: SESSION_CREDENTIALS_SELECT,
    });
  }

  findSessionId(companyId: string): Promise<{ id: string } | null> {
    return this.prisma.whatsappSession.findUnique({
      where: { companyId },
      select: { id: true },
    });
  }

  findSessionSnapshot(companyId: string): Promise<RawSessionSnapshot | null> {
    return this.prisma.whatsappSession.findUnique({
      where: { companyId },
      select: SESSION_SNAPSHOT_SELECT,
    });
  }

  findSessionByTenant(
    tenantId: string,
  ): Promise<{ id: string; companyId: string } | null> {
    return this.prisma.whatsappSession.findUnique({
      where: { waServiceTenantId: tenantId },
      select: { id: true, companyId: true },
    });
  }

  findSessionCompanyByTenant(
    tenantId: string,
  ): Promise<{ companyId: string } | null> {
    return this.prisma.whatsappSession.findUnique({
      where: { waServiceTenantId: tenantId },
      select: { companyId: true },
    });
  }

  findSessionMeta(sessionId: string): Promise<RawSessionMeta | null> {
    return this.prisma.whatsappSession.findUnique({
      where: { id: sessionId },
      select: SESSION_META_SELECT,
    });
  }

  findSetupStatus(
    companyId: string,
  ): Promise<{ waServiceTenantId: string | null; waServiceApiKey: string | null } | null> {
    return this.prisma.whatsappSession.findUnique({
      where: { companyId },
      select: {
        waServiceTenantId: true,
        waServiceApiKey: true,
      },
    });
  }

  createSession(
    data: Prisma.WhatsappSessionUncheckedCreateInput,
  ): Promise<{ id: string }> {
    return this.prisma.whatsappSession.create({
      data,
      select: { id: true },
    });
  }

  upsertSessionSnapshot(
    companyId: string,
    create: Prisma.WhatsappSessionUncheckedCreateInput,
    update: Prisma.WhatsappSessionUncheckedUpdateInput,
  ) {
    return this.prisma.whatsappSession.upsert({
      where: { companyId },
      create,
      update,
    });
  }

  upsertSessionCredentials(
    companyId: string,
    credentials: {
      waServiceTenantId: string;
      waServiceApiKey: string;
      waServiceWebhookSecret: string;
    },
  ) {
    return this.prisma.whatsappSession.upsert({
      where: { companyId },
      create: { companyId, ...credentials },
      update: credentials,
    });
  }

  clearSessionCredentials(companyId: string) {
    return this.prisma.whatsappSession.updateMany({
      where: { companyId },
      data: {
        waServiceTenantId: null,
        waServiceApiKey: null,
        waServiceWebhookSecret: null,
      },
    });
  }

  updateSessionForTenantDeleted(companyId: string) {
    return this.prisma.whatsappSession.update({
      where: { companyId },
      data: {
        waServiceTenantId: null,
        waServiceApiKey: null,
        waServiceWebhookSecret: null,
        status: "DISCONNECTED",
        stage: "IDLE",
        qrCode: null,
        phoneNumber: null,
        deviceName: null,
        lastDisconnectedAt: new Date(),
        lastError: "Tenant dihapus dari wa-service oleh admin.",
      },
    });
  }

  // ─── Message logs ────────────────────────────────────────────────

  createMessageLog(data: Prisma.WhatsappMessageLogUncheckedCreateInput) {
    return this.prisma.whatsappMessageLog.create({ data });
  }

  findMessages(
    where: Prisma.WhatsappMessageLogWhereInput,
    take: number,
    cursor?: string,
  ) {
    return this.prisma.whatsappMessageLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }

  // ─── Enrichment queries (for listMessages) ──────────────────────

  findUsersByPhone(phoneVariants: string[]) {
    return this.prisma.user.findMany({
      where: { phone: { in: phoneVariants } },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        company: { select: { id: true, name: true } },
      },
    });
  }

  findCustomersByPhone(phoneVariants: string[]) {
    return this.prisma.customer.findMany({
      where: { phone: { in: phoneVariants } },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        memberLevel: true,
        company: { select: { id: true, name: true } },
      },
    });
  }

  // ─── Receipt data ────────────────────────────────────────────────

  findTransactionForReceipt(
    transactionId: string,
    companyId: string,
  ): Promise<RawTransactionReceipt | null> {
    return this.prisma.transaction.findFirst({
      where: { id: transactionId, user: { companyId } },
      include: TRANSACTION_RECEIPT_INCLUDE,
    });
  }

  findServiceOrderByTransaction(transactionId: string) {
    return this.prisma.serviceOrder.findUnique({
      where: { transactionId },
      include: { items: { orderBy: { createdAt: "asc" } } },
    });
  }

  findCompanyBasic(companyId: string) {
    return this.prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, address: true, phone: true },
    });
  }

  findReceiptSettings(branchId: string | null) {
    return this.prisma.setting.findMany({
      where: {
        group: "receipt",
        OR: [{ branchId }, { branchId: null }],
      },
      select: { key: true, value: true, branchId: true },
    });
  }

  // ─── Socket service queries ──────────────────────────────────────

  findAllConfiguredSessions() {
    return this.prisma.whatsappSession.findMany({
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
  }
}

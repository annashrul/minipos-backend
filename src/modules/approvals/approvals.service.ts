import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  ApprovalListResponse,
  ApprovalPendingCountResponse,
  ApprovalResponse,
  CreateApprovalDto,
  ListApprovalsQueryDto,
  RejectApprovalDto,
  ReviewApprovalDto,
} from "@/contracts";
import { PrismaService } from "../prisma/prisma.service";

const APPROVAL_SELECT = {
  id: true,
  type: true,
  status: true,
  requestedBy: true,
  requester: {
    select: {
      id: true,
      name: true,
      email: true,
      companyId: true,
    },
  },
  approvedBy: true,
  approver: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
  referenceId: true,
  details: true,
  reason: true,
  rejectionNote: true,
  branchId: true,
  branch: {
    select: {
      id: true,
      name: true,
      companyId: true,
    },
  },
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ApprovalRequestSelect;

type RawApproval = Prisma.ApprovalRequestGetPayload<{
  select: typeof APPROVAL_SELECT;
}>;

type ApprovalDetailsMeta = {
  referenceType?: string | null;
  amount?: number | null;
  expiresAt?: string | null;
  reviewedAt?: string | null;
  reviewNotes?: string | null;
  companyId?: string | null;
};

@Injectable()
export class ApprovalsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    companyId: string,
    query: ListApprovalsQueryDto,
  ): Promise<ApprovalListResponse> {
    const where = this.buildListWhere(companyId, query);

    const [rows, total] = await Promise.all([
      this.prisma.approvalRequest.findMany({
        where,
        select: APPROVAL_SELECT,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
      this.prisma.approvalRequest.count({ where }),
    ]);

    return {
      approvals: rows.map(toApprovalResponse),
      total,
      totalPages: Math.ceil(total / query.perPage),
    };
  }

  async pendingCount(
    companyId: string,
  ): Promise<ApprovalPendingCountResponse> {
    const count = await this.prisma.approvalRequest.count({
      where: {
        status: "PENDING",
        ...this.tenantWhere(companyId),
      },
    });
    return { count };
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<ApprovalResponse> {
    const approval = await this.prisma.approvalRequest.findFirst({
      where: { id, ...this.tenantWhere(companyId) },
      select: APPROVAL_SELECT,
    });
    if (!approval) throw new NotFoundException("Approval not found");
    return toApprovalResponse(approval);
  }

  async create(
    companyId: string,
    userId: string,
    dto: CreateApprovalDto,
  ): Promise<ApprovalResponse> {
    if (dto.branchId) await this.assertBranch(companyId, dto.branchId);

    const expiresAt = dto.expiresInMinutes
      ? new Date(Date.now() + dto.expiresInMinutes * 60_000)
      : null;

    const meta: ApprovalDetailsMeta = {
      referenceType: dto.referenceType ?? null,
      amount: dto.amount ?? null,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      companyId,
    };

    let extraDetails: Record<string, unknown> = {};
    if (dto.details) {
      try {
        const parsed = JSON.parse(dto.details);
        if (parsed && typeof parsed === "object") {
          extraDetails = parsed as Record<string, unknown>;
        }
      } catch {
        // ignore non-JSON details
      }
    }
    const merged = serializeMeta({
      ...(meta as unknown as Record<string, unknown>),
      ...extraDetails,
    } as ApprovalDetailsMeta);

    const created = await this.prisma.approvalRequest.create({
      data: {
        type: dto.type,
        status: "PENDING",
        requestedBy: userId,
        referenceId: dto.referenceId ?? null,
        reason: dto.requestedReason,
        branchId: dto.branchId ?? null,
        details: merged,
      },
      select: APPROVAL_SELECT,
    });

    return toApprovalResponse(created);
  }

  async approve(
    companyId: string,
    userId: string,
    id: string,
    dto: ReviewApprovalDto,
  ): Promise<ApprovalResponse> {
    const existing = await this.prisma.approvalRequest.findFirst({
      where: { id, ...this.tenantWhere(companyId) },
      select: {
        id: true,
        status: true,
        details: true,
      },
    });
    if (!existing) throw new NotFoundException("Approval not found");
    if (existing.status !== "PENDING") {
      throw new BadRequestException(
        "Hanya approval dengan status PENDING yang dapat disetujui",
      );
    }

    const meta = parseMeta(existing.details);
    if (meta.expiresAt) {
      const expiresAt = new Date(meta.expiresAt);
      if (!Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
        throw new BadRequestException("Persetujuan sudah expired");
      }
    }

    const reviewedAt = new Date();
    const updatedMeta: ApprovalDetailsMeta = {
      ...meta,
      reviewedAt: reviewedAt.toISOString(),
      reviewNotes: dto.reviewNotes ?? null,
    };

    const updated = await this.prisma.approvalRequest.update({
      where: { id },
      data: {
        status: "APPROVED",
        approvedBy: userId,
        details: serializeMeta(updatedMeta),
      },
      select: APPROVAL_SELECT,
    });

    return toApprovalResponse(updated);
  }

  async reject(
    companyId: string,
    userId: string,
    id: string,
    dto: RejectApprovalDto,
  ): Promise<ApprovalResponse> {
    const existing = await this.prisma.approvalRequest.findFirst({
      where: { id, ...this.tenantWhere(companyId) },
      select: {
        id: true,
        status: true,
        details: true,
      },
    });
    if (!existing) throw new NotFoundException("Approval not found");
    if (existing.status !== "PENDING") {
      throw new BadRequestException(
        "Hanya approval dengan status PENDING yang dapat ditolak",
      );
    }

    const reviewedAt = new Date();
    const meta = parseMeta(existing.details);
    const updatedMeta: ApprovalDetailsMeta = {
      ...meta,
      reviewedAt: reviewedAt.toISOString(),
      reviewNotes: dto.reviewNotes,
    };

    const updated = await this.prisma.approvalRequest.update({
      where: { id },
      data: {
        status: "REJECTED",
        approvedBy: userId,
        rejectionNote: dto.reviewNotes,
        details: serializeMeta(updatedMeta),
      },
      select: APPROVAL_SELECT,
    });

    return toApprovalResponse(updated);
  }

  async delete(
    companyId: string,
    userId: string,
    id: string,
  ): Promise<{ success: true }> {
    const existing = await this.prisma.approvalRequest.findFirst({
      where: { id, ...this.tenantWhere(companyId) },
      select: { id: true, status: true, requestedBy: true },
    });
    if (!existing) throw new NotFoundException("Approval not found");
    if (existing.status !== "PENDING") {
      throw new BadRequestException(
        "Hanya approval dengan status PENDING yang dapat dibatalkan",
      );
    }
    if (existing.requestedBy !== userId) {
      throw new ForbiddenException(
        "Hanya pembuat permintaan yang dapat membatalkan approval ini",
      );
    }

    await this.prisma.approvalRequest.delete({ where: { id } });
    return { success: true };
  }

  private buildListWhere(
    companyId: string,
    query: ListApprovalsQueryDto,
  ): Prisma.ApprovalRequestWhereInput {
    const { type, status, referenceType, branchId, requestedBy, search, from, to } =
      query;

    const where: Prisma.ApprovalRequestWhereInput = {
      ...this.tenantWhere(companyId),
    };

    if (type) where.type = type;
    if (status) where.status = status;
    if (branchId) where.branchId = branchId;
    if (requestedBy) where.requestedBy = requestedBy;
    if (search) {
      where.referenceId = { contains: search, mode: "insensitive" };
    }
    if (referenceType) {
      where.details = { contains: `"referenceType":"${referenceType}"` };
    }
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    return where;
  }

  private tenantWhere(
    companyId: string,
  ): Prisma.ApprovalRequestWhereInput {
    return {
      OR: [
        { requester: { companyId } },
        { branch: { companyId } },
      ],
    };
  }

  private async assertBranch(companyId: string, branchId: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, companyId },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException("Branch not found");
  }
}

function serializeMeta(meta: ApprovalDetailsMeta): string {
  return JSON.stringify(meta);
}

function parseMeta(details: string | null): ApprovalDetailsMeta {
  if (!details) return {};
  try {
    const parsed = JSON.parse(details) as unknown;
    if (parsed && typeof parsed === "object") {
      return parsed as ApprovalDetailsMeta;
    }
    return {};
  } catch {
    return {};
  }
}

function toApprovalResponse(a: RawApproval): ApprovalResponse {
  const meta = parseMeta(a.details);
  return {
    id: a.id,
    type: a.type,
    referenceType: meta.referenceType ?? null,
    referenceId: a.referenceId,
    requestedReason: a.reason ?? "",
    amount: meta.amount ?? null,
    status: a.status,
    requestedBy: a.requestedBy,
    requester: a.requester
      ? {
          id: a.requester.id,
          name: a.requester.name,
          email: a.requester.email,
        }
      : null,
    reviewedBy: a.approvedBy,
    reviewer: a.approver
      ? {
          id: a.approver.id,
          name: a.approver.name,
          email: a.approver.email,
        }
      : null,
    reviewedAt:
      meta.reviewedAt ??
      (a.status !== "PENDING" ? a.updatedAt.toISOString() : null),
    reviewNotes:
      a.status === "REJECTED"
        ? a.rejectionNote ?? meta.reviewNotes ?? null
        : meta.reviewNotes ?? null,
    branchId: a.branchId,
    branch: a.branch ? { id: a.branch.id, name: a.branch.name } : null,
    companyId: a.branch?.companyId ?? a.requester?.companyId ?? meta.companyId ?? null,
    expiresAt: meta.expiresAt ?? null,
    details: a.details ?? null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

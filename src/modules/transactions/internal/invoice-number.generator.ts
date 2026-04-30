import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { normalizeCodePart, randomInvoicePart } from "./transactions.helpers";

@Injectable()
export class InvoiceNumberGenerator {
  constructor(private readonly prisma: PrismaService) {}

  async generate(companyId: string, branchId: string | null): Promise<string> {
    const [company, branch] = await Promise.all([
      this.prisma.company.findUnique({
        where: { id: companyId },
        select: { slug: true, name: true },
      }),
      branchId
        ? this.prisma.branch.findUnique({
            where: { id: branchId },
            select: { code: true, name: true },
          })
        : Promise.resolve(null),
    ]);

    const companyPart = normalizeCodePart(
      company?.slug ?? company?.name,
      "COMPANY",
    );
    const branchPart = normalizeCodePart(branch?.code ?? branch?.name, "MAIN");
    return `${companyPart}-${branchPart}-${randomInvoicePart(8)}`;
  }
}

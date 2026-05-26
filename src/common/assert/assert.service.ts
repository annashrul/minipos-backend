import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@/modules/prisma/prisma.service";

@Injectable()
export class AssertService {
  constructor(private readonly prisma: PrismaService) {}

  async branch(companyId: string, branchId: string): Promise<void> {
    const row = await this.prisma.branch.findFirst({
      where: { id: branchId, companyId },
      select: { id: true },
    });
    if (!row) throw new NotFoundException("Cabang tidak ditemukan");
  }

  async supplier(companyId: string, supplierId: string): Promise<void> {
    const row = await this.prisma.supplier.findFirst({
      where: { id: supplierId, companyId },
      select: { id: true },
    });
    if (!row) throw new NotFoundException("Supplier tidak ditemukan");
  }

  async customer(companyId: string, customerId: string): Promise<void> {
    const row = await this.prisma.customer.findFirst({
      where: { id: customerId, companyId },
      select: { id: true },
    });
    if (!row) throw new NotFoundException("Customer tidak ditemukan");
  }

  async product(companyId: string, productId: string): Promise<void> {
    const row = await this.prisma.product.findFirst({
      where: { id: productId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!row) throw new NotFoundException("Produk tidak ditemukan");
  }

  async user(companyId: string, userId: string): Promise<void> {
    const row = await this.prisma.user.findFirst({
      where: { id: userId, companyId },
      select: { id: true },
    });
    if (!row) throw new NotFoundException("User tidak ditemukan");
  }

  async category(companyId: string, categoryId: string): Promise<void> {
    const row = await this.prisma.category.findFirst({
      where: { id: categoryId, companyId },
      select: { id: true },
    });
    if (!row) throw new NotFoundException("Kategori tidak ditemukan");
  }

  async accountCategory(companyId: string, categoryId: string): Promise<void> {
    const row = await this.prisma.accountCategory.findFirst({
      where: { id: categoryId, companyId },
      select: { id: true },
    });
    if (!row) throw new NotFoundException("Kategori akun tidak ditemukan");
  }
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CreateVehicleDto,
  ListVehiclesQueryDto,
  UpdateVehicleDto,
  VehicleListResponse,
  VehicleResponse,
} from "./dto/vehicle.dto";
import { VehiclesRepository, type RawVehicle } from "./vehicles.repository";

@Injectable()
export class VehiclesService {
  constructor(private readonly repo: VehiclesRepository) {}

  async list(
    companyId: string,
    query: ListVehiclesQueryDto,
  ): Promise<VehicleListResponse> {
    const { page, limit, search, customerId, type, isActive } = query;

    const where: Prisma.VehicleWhereInput = { companyId };
    if (customerId) where.customerId = customerId;
    if (type) where.type = type;
    if (typeof isActive === "boolean") where.isActive = isActive;
    if (search) {
      const q = search.trim();
      where.OR = [
        { plateNumber: { contains: q, mode: "insensitive" } },
        { brand: { name: { contains: q, mode: "insensitive" } } },
        { modelRef: { name: { contains: q, mode: "insensitive" } } },
        { vin: { contains: q, mode: "insensitive" } },
        { customer: { name: { contains: q, mode: "insensitive" } } },
      ];
    }

    const [total, items] = await Promise.all([
      this.repo.count(where),
      this.repo.findMany(where, { updatedAt: "desc" }, (page - 1) * limit, limit),
    ]);

    return {
      items: items.map((v) => this.toResponse(v)),
      total,
      page,
      limit,
    };
  }

  async findById(companyId: string, id: string): Promise<VehicleResponse> {
    const v = await this.repo.findById(companyId, id);
    if (!v) throw new NotFoundException("Kendaraan tidak ditemukan");
    return this.toResponse(v);
  }

  async create(
    companyId: string,
    dto: CreateVehicleDto,
  ): Promise<VehicleResponse> {
    // Verifikasi customer milik company yang sama.
    const customer = await this.repo.findCustomer(companyId, dto.customerId);
    if (!customer) {
      throw new NotFoundException("Customer tidak ditemukan");
    }

    const plate = dto.plateNumber.toUpperCase().replace(/\s+/g, " ").trim();

    const existing = await this.repo.findExistingPlate(companyId, plate);
    if (existing) {
      throw new ConflictException(`Kendaraan dengan plat ${plate} sudah terdaftar`);
    }

    const created = await this.repo.create({
      companyId,
      customerId: dto.customerId,
      plateNumber: plate,
      type: dto.type ?? "MOTOR",
      brandId: dto.brandId ?? null,
      modelId: dto.modelId ?? null,
      year: dto.year ?? null,
      color: dto.color ?? null,
      vin: dto.vin ?? null,
      engineNumber: dto.engineNumber ?? null,
      engineCapacity: dto.engineCapacity ?? null,
      transmission: dto.transmission ?? null,
      fuelType: dto.fuelType ?? null,
      mileage: dto.mileage ?? null,
      photoUrl: dto.photoUrl ?? null,
      notes: dto.notes ?? null,
    });
    return this.toResponse(created);
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateVehicleDto,
  ): Promise<VehicleResponse> {
    const existing = await this.repo.findExistingById(companyId, id);
    if (!existing) throw new NotFoundException("Kendaraan tidak ditemukan");

    if (dto.customerId) {
      const customer = await this.repo.findCustomer(companyId, dto.customerId);
      if (!customer) throw new NotFoundException("Customer tidak ditemukan");
    }

    let normalizedPlate: string | undefined;
    if (dto.plateNumber) {
      normalizedPlate = dto.plateNumber.toUpperCase().replace(/\s+/g, " ").trim();
      if (normalizedPlate !== existing.plateNumber) {
        const conflict = await this.repo.findExistingPlate(companyId, normalizedPlate, id);
        if (conflict) {
          throw new ConflictException(
            `Kendaraan dengan plat ${normalizedPlate} sudah terdaftar`,
          );
        }
      }
    }

    const data: Prisma.VehicleUpdateInput = {};
    if (dto.customerId) data.customer = { connect: { id: dto.customerId } };
    if (normalizedPlate) data.plateNumber = normalizedPlate;
    if (dto.type) data.type = dto.type;
    if (dto.brandId !== undefined) {
      data.brand = dto.brandId
        ? { connect: { id: dto.brandId } }
        : { disconnect: true };
    }
    if (dto.modelId !== undefined) {
      data.modelRef = dto.modelId
        ? { connect: { id: dto.modelId } }
        : { disconnect: true };
    }
    if (dto.year !== undefined) data.year = dto.year;
    if (dto.color !== undefined) data.color = dto.color;
    if (dto.vin !== undefined) data.vin = dto.vin;
    if (dto.engineNumber !== undefined) data.engineNumber = dto.engineNumber;
    if (dto.engineCapacity !== undefined) data.engineCapacity = dto.engineCapacity;
    if (dto.transmission !== undefined) data.transmission = dto.transmission;
    if (dto.fuelType !== undefined) data.fuelType = dto.fuelType;
    if (dto.mileage !== undefined) data.mileage = dto.mileage;
    if (dto.photoUrl !== undefined) data.photoUrl = dto.photoUrl;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.lastServicedAt !== undefined) {
      data.lastServicedAt = dto.lastServicedAt
        ? new Date(dto.lastServicedAt)
        : null;
    }
    if (dto.nextServiceKm !== undefined) data.nextServiceKm = dto.nextServiceKm;
    if (dto.nextServiceDate !== undefined) {
      data.nextServiceDate = dto.nextServiceDate
        ? new Date(dto.nextServiceDate)
        : null;
    }

    const updated = await this.repo.update(id, data);
    return this.toResponse(updated);
  }

  /**
   * Aggregat full history sebuah kendaraan: timeline service order, total
   * spend, jumlah kunjungan, mekanik favorit, top sparepart pernah dipakai.
   * Dipakai oleh halaman /vehicles/[id] sebagai "service book" digital.
   */
  async history(companyId: string, id: string) {
    const vehicle = await this.findById(companyId, id);

    const orders = await this.repo.findServiceOrders(companyId, id);

    // Stats agregat
    const paidOrders = orders.filter((o) => o.status === "DIBAYAR");
    const totalSpend = paidOrders.reduce(
      (s, o) => s + (o.finalAmount ?? 0),
      0,
    );
    const totalVisits = paidOrders.length;
    const lastServicedAt = paidOrders[0]?.paidAt ?? null;

    // Mekanik favorit: hitung kemunculan mechanic per item
    const mechanicCount = new Map<string, { id: string; name: string; count: number }>();
    for (const o of paidOrders) {
      for (const item of o.items) {
        if (!item.mechanic) continue;
        const cur = mechanicCount.get(item.mechanic.id);
        if (cur) cur.count++;
        else mechanicCount.set(item.mechanic.id, { ...item.mechanic, count: 1 });
      }
    }
    const topMechanics = [...mechanicCount.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    // Top sparepart: hitung total qty per nama item (PRODUCT only)
    const partCount = new Map<string, { name: string; totalQty: number; lastUsedAt: Date }>();
    for (const o of paidOrders) {
      for (const item of o.items) {
        if (item.itemType !== "PRODUCT") continue;
        const key = item.name.toLowerCase();
        const cur = partCount.get(key);
        if (cur) {
          cur.totalQty += item.quantity;
          if (o.paidAt && o.paidAt > cur.lastUsedAt) cur.lastUsedAt = o.paidAt;
        } else {
          partCount.set(key, {
            name: item.name,
            totalQty: item.quantity,
            lastUsedAt: o.paidAt ?? new Date(0),
          });
        }
      }
    }
    const topParts = [...partCount.values()]
      .sort((a, b) => b.totalQty - a.totalQty)
      .slice(0, 10)
      .map((p) => ({
        name: p.name,
        totalQty: p.totalQty,
        lastUsedAt: p.lastUsedAt.toISOString(),
      }));

    // Timeline: status + total per SO untuk render di UI
    const timeline = orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      complaint: o.complaint,
      diagnose: o.diagnose,
      mileageIn: o.mileageIn,
      mileageOut: o.mileageOut,
      mechanic: o.mechanic ? { id: o.mechanic.id, name: o.mechanic.name } : null,
      branch: o.branch ? { id: o.branch.id, name: o.branch.name } : null,
      finalAmount: o.finalAmount,
      paidAt: o.paidAt?.toISOString() ?? null,
      nextServiceAt: o.nextServiceAt?.toISOString() ?? null,
      createdAt: o.createdAt.toISOString(),
      itemCount: o.items.length,
      items: o.items.map((it) => ({
        id: it.id,
        itemType: it.itemType,
        name: it.name,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        subtotal: it.subtotal,
        mechanic: it.mechanic
          ? { id: it.mechanic.id, name: it.mechanic.name }
          : null,
      })),
    }));

    return {
      vehicle,
      stats: {
        totalSpend,
        totalVisits,
        lastServicedAt: lastServicedAt?.toISOString() ?? null,
        topMechanics,
        topParts,
      },
      timeline,
    };
  }

  async delete(
    companyId: string,
    id: string,
  ): Promise<{ id: string; deleted: true }> {
    const existing = await this.repo.findWithServiceOrderCount(companyId, id);
    if (!existing) throw new NotFoundException("Kendaraan tidak ditemukan");
    if (existing._count.serviceOrders > 0) {
      // Soft delete kalau punya service history — hindari kehilangan history.
      await this.repo.softDelete(id);
      return { id, deleted: true };
    }
    await this.repo.hardDelete(id);
    return { id, deleted: true };
  }

  private toResponse(v: RawVehicle): VehicleResponse {
    return {
      id: v.id,
      customerId: v.customerId,
      customer: v.customer
        ? { id: v.customer.id, name: v.customer.name, phone: v.customer.phone }
        : null,
      plateNumber: v.plateNumber,
      type: v.type,
      brandId: v.brandId,
      brand: v.brand ? { id: v.brand.id, name: v.brand.name } : null,
      modelId: v.modelId,
      model: v.modelRef ? { id: v.modelRef.id, name: v.modelRef.name } : null,
      year: v.year,
      color: v.color,
      vin: v.vin,
      engineNumber: v.engineNumber,
      engineCapacity: v.engineCapacity,
      transmission: v.transmission,
      fuelType: v.fuelType,
      mileage: v.mileage,
      photoUrl: v.photoUrl,
      notes: v.notes,
      isActive: v.isActive,
      lastServicedAt: v.lastServicedAt?.toISOString() ?? null,
      nextServiceKm: v.nextServiceKm,
      nextServiceDate: v.nextServiceDate?.toISOString() ?? null,
      serviceOrderCount: v._count.serviceOrders,
      createdAt: v.createdAt.toISOString(),
      updatedAt: v.updatedAt.toISOString(),
    };
  }
}

// Suppress ts unused — BadRequestException kept for future expansion.
void BadRequestException;

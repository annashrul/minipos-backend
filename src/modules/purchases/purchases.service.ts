import { Injectable } from "@nestjs/common";
import type {
  ClosePurchaseDto,
  ClosePurchaseResponse,
  CreatePurchaseDto,
  ListPurchasesQueryDto,
  PurchaseListResponse,
  PurchaseOrderDetailResponse,
  PurchaseSummaryResponse,
  ReceivePurchaseDto,
  ReceivePurchaseResponse,
  UpdatePurchaseDto,
  UpdatePurchaseStatusDto,
} from "@/contracts";
import { PurchaseQueryService } from "./internal/purchase-query.service";
import { PurchaseReceivingService } from "./internal/purchase-receiving.service";
import { PurchaseWriteService } from "./internal/purchase-write.service";

/**
 * Facade tipis. Delegasi:
 *  - PurchaseQueryService     → list / summary / findById
 *  - PurchaseWriteService     → create / update / updateStatus / delete (CRUD + state)
 *  - PurchaseReceivingService → receive (GoodsReceipt + stock update + supplier debt) / close
 */
@Injectable()
export class PurchasesService {
  constructor(
    private readonly query: PurchaseQueryService,
    private readonly write: PurchaseWriteService,
    private readonly receiving: PurchaseReceivingService,
  ) {}

  list(
    companyId: string,
    query: ListPurchasesQueryDto,
  ): Promise<PurchaseListResponse> {
    return this.query.list(companyId, query);
  }
  summary(
    companyId: string,
    query: ListPurchasesQueryDto,
  ): Promise<PurchaseSummaryResponse> {
    return this.query.summary(companyId, query);
  }
  findById(
    companyId: string,
    id: string,
  ): Promise<PurchaseOrderDetailResponse> {
    return this.query.findById(companyId, id);
  }

  create(
    companyId: string,
    userId: string,
    dto: CreatePurchaseDto,
  ): Promise<PurchaseOrderDetailResponse> {
    return this.write.create(companyId, userId, dto);
  }
  update(
    companyId: string,
    id: string,
    dto: UpdatePurchaseDto,
  ): Promise<PurchaseOrderDetailResponse> {
    return this.write.update(companyId, id, dto);
  }
  updateStatus(
    companyId: string,
    id: string,
    dto: UpdatePurchaseStatusDto,
  ): Promise<PurchaseOrderDetailResponse> {
    return this.write.updateStatus(companyId, id, dto);
  }
  delete(companyId: string, id: string): Promise<{ success: true }> {
    return this.write.delete(companyId, id);
  }

  receive(
    companyId: string,
    userId: string,
    id: string,
    dto: ReceivePurchaseDto,
  ): Promise<ReceivePurchaseResponse> {
    return this.receiving.receive(companyId, userId, id, dto);
  }
  close(
    companyId: string,
    id: string,
    dto: ClosePurchaseDto,
  ): Promise<ClosePurchaseResponse> {
    return this.receiving.close(companyId, id, dto);
  }
}

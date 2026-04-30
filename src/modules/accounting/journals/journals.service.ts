import { Injectable } from "@nestjs/common";
import type {
  CreateJournalDto,
  JournalDetailResponse,
  JournalListResponse,
  ListJournalsQueryDto,
  UpdateJournalDto,
  VoidJournalDto,
} from "@/contracts";
import { JournalsCrudService } from "./internal/journals-crud.service";
import { JournalsLifecycleService } from "./internal/journals-lifecycle.service";

/**
 * Facade tipis. Delegasi:
 *  - JournalsCrudService      → list / findById / create / update / delete / changeHistory
 *  - JournalsLifecycleService → post / void / submitForApproval / approve / reject
 *  - JournalsContext          → assertBranch / assertAccountsValid / resolvePeriod / assertPeriodOpen
 */
@Injectable()
export class JournalsService {
  constructor(
    private readonly crud: JournalsCrudService,
    private readonly lifecycle: JournalsLifecycleService,
  ) {}

  list(
    companyId: string,
    query: ListJournalsQueryDto,
  ): Promise<JournalListResponse> {
    return this.crud.list(companyId, query);
  }
  findById(companyId: string, id: string): Promise<JournalDetailResponse> {
    return this.crud.findById(companyId, id);
  }
  create(
    companyId: string,
    userId: string,
    dto: CreateJournalDto,
  ): Promise<JournalDetailResponse> {
    return this.crud.create(companyId, userId, dto);
  }
  update(
    companyId: string,
    userId: string,
    id: string,
    dto: UpdateJournalDto,
  ): Promise<JournalDetailResponse> {
    return this.crud.update(companyId, userId, id, dto);
  }
  delete(companyId: string, id: string): Promise<{ success: true }> {
    return this.crud.delete(companyId, id);
  }
  changeHistory(companyId: string, journalId: string): Promise<unknown[]> {
    return this.crud.changeHistory(companyId, journalId);
  }

  post(
    companyId: string,
    userId: string,
    id: string,
  ): Promise<JournalDetailResponse> {
    return this.lifecycle.post(companyId, userId, id);
  }
  voidEntry(
    companyId: string,
    userId: string,
    id: string,
    dto: VoidJournalDto,
  ): Promise<JournalDetailResponse & { reversingEntryNumber?: string }> {
    return this.lifecycle.voidEntry(companyId, userId, id, dto);
  }
  submitForApproval(
    companyId: string,
    userId: string,
    id: string,
  ): Promise<JournalDetailResponse> {
    return this.lifecycle.submitForApproval(companyId, userId, id);
  }
  approve(
    companyId: string,
    userId: string,
    id: string,
  ): Promise<JournalDetailResponse> {
    return this.lifecycle.approve(companyId, userId, id);
  }
  reject(
    companyId: string,
    userId: string,
    id: string,
    reason: string,
  ): Promise<JournalDetailResponse> {
    return this.lifecycle.reject(companyId, userId, id, reason);
  }
}

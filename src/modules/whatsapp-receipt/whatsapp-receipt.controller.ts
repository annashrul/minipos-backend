import { Controller, Get, Param, Query } from "@nestjs/common";
import {
  WhatsAppReceiptLinkQuerySchema,
  WhatsAppReceiptTextParamsSchema,
  type WhatsAppReceiptLinkQueryDto,
  type WhatsAppReceiptTextParamsDto,
} from "@/contracts";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { CurrentCompany } from "../auth/current-company.decorator";
import { WhatsappReceiptService } from "./whatsapp-receipt.service";

@Controller("whatsapp-receipt")
export class WhatsappReceiptController {
  constructor(private readonly receipt: WhatsappReceiptService) {}

  @Get("text/:transactionId")
  async text(
    @CurrentCompany() companyId: string,
    @Param(new ZodValidationPipe(WhatsAppReceiptTextParamsSchema))
    params: WhatsAppReceiptTextParamsDto,
  ) {
    const text = await this.receipt.generateReceiptText(
      companyId,
      params.transactionId,
    );
    return { data: { text } };
  }

  @Get("link")
  async link(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(WhatsAppReceiptLinkQuerySchema))
    query: WhatsAppReceiptLinkQueryDto,
  ) {
    const url = await this.receipt.generateLink(
      companyId,
      query.transactionId,
      query.phone,
    );
    return { data: { url } };
  }
}

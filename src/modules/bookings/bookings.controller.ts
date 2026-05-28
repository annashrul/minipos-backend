import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import {
  CreateBookingSchema,
  ListBookingsQuerySchema,
  TransitionBookingStatusSchema,
  UpdateBookingSchema,
  type CreateBookingDto,
  type ListBookingsQueryDto,
  type TransitionBookingStatusDto,
  type UpdateBookingDto,
} from "./dto/bookings.dto";
import { type AuthUser } from "@/contracts";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody, ApiZodQuery } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { CurrentUser } from "@/modules/auth/current-user.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { BookingsService } from "./bookings.service";

@ApiTags("Bookings")
@ApiBearerAuth()
@Controller("bookings")
@UseGuards(AccessGuard)
export class BookingsController {
  constructor(private readonly svc: BookingsService) {}

  @Get()
  @RequireAccess("bookings", "view")
  @ApiOperation({ summary: "List bookings" })
  @ApiZodQuery(ListBookingsQuerySchema)
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListBookingsQuerySchema))
    query: ListBookingsQueryDto,
  ) {
    const data = await this.svc.list(companyId, query);
    return { data };
  }

  @Get("stats")
  @RequireAccess("bookings", "view")
  @ApiOperation({ summary: "Booking statistics" })
  async stats(
    @CurrentCompany() companyId: string,
    @Query("branchId") branchId?: string,
    @Query("bookingType") bookingType?: string,
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo") dateTo?: string,
    @Query("search") search?: string,
  ) {
    const data = await this.svc.stats(companyId, {
      branchId,
      bookingType: bookingType as never,
      dateFrom,
      dateTo,
      search,
    });
    return { data };
  }

  @Get(":id")
  @RequireAccess("bookings", "view")
  @ApiOperation({ summary: "Get booking by ID" })
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.svc.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("bookings", "create")
  @ApiOperation({ summary: "Create booking" })
  @ApiZodBody(CreateBookingSchema)
  async create(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateBookingSchema)) body: CreateBookingDto,
  ) {
    const data = await this.svc.create(companyId, body, user?.id ?? null);
    return { data };
  }

  @Patch(":id")
  @RequireAccess("bookings", "update")
  @ApiOperation({ summary: "Update booking" })
  @ApiZodBody(UpdateBookingSchema)
  async update(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateBookingSchema)) body: UpdateBookingDto,
  ) {
    const data = await this.svc.update(companyId, id, body);
    return { data };
  }

  @Patch(":id/transition")
  @RequireAccess("bookings", "update")
  @ApiOperation({ summary: "Transition booking status" })
  @ApiZodBody(TransitionBookingStatusSchema)
  async transition(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(TransitionBookingStatusSchema))
    body: TransitionBookingStatusDto,
  ) {
    const data = await this.svc.transition(companyId, id, body);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("bookings", "delete")
  @ApiOperation({ summary: "Delete booking" })
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.svc.delete(companyId, id);
    return { data };
  }
}

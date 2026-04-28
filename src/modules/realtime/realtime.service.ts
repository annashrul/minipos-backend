import { Injectable, Logger } from "@nestjs/common";
import Pusher from "pusher";

/**
 * Stable event names — diimport di service lain saat emit.
 * Frontend subscribe ke channel "pos-events" lalu listen by event name.
 */
export const EVENTS = {
  TRANSACTION_CREATED: "transaction:created",
  TRANSACTION_VOIDED: "transaction:voided",
  TRANSACTION_REFUNDED: "transaction:refunded",
  STOCK_UPDATED: "stock:updated",
  SHIFT_OPENED: "shift:opened",
  SHIFT_CLOSED: "shift:closed",
  SHIFT_RECLOSED: "shift:reclosed",
  DASHBOARD_REFRESH: "dashboard:refresh",
  ORDER_QUEUE_CREATED: "order-queue:created",
  ORDER_QUEUE_UPDATED: "order-queue:updated",
  ORDER_QUEUE_CANCELLED: "order-queue:cancelled",
  TABLE_ORDER_CREATED: "table-order:created",
  TABLE_ORDER_APPROVED: "table-order:approved",
  TABLE_ORDER_REJECTED: "table-order:rejected",
  TABLE_ORDER_READY: "table-order:ready",
  TABLE_ORDER_STATUS: "table-order:status",
  TABLE_SESSION_UPDATED: "table-session:updated",
  TABLE_SESSION_CLOSED: "table-session:closed",
  TABLE_PAYMENT_UPDATED: "table-payment:updated",
  CONFIG_POS_UPDATED: "config:pos-updated",
  CONFIG_RECEIPT_UPDATED: "config:receipt-updated",
  CONFIG_KITCHEN_UPDATED: "config:kitchen-updated",
  SUBSCRIPTION_UPDATED: "subscription:updated",
  COMPANY_REGISTERED: "company:registered",
  BRANCH_UPDATED: "branch:updated",
  CATEGORY_UPDATED: "category:updated",
  BUNDLE_UPDATED: "bundle:updated",
  MENU_ACCESS_UPDATED: "menu-access:updated",
  PLAN_ACCESS_UPDATED: "plan-access:updated",
} as const;

export type AppEventName = (typeof EVENTS)[keyof typeof EVENTS];

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly pusher: Pusher | null;
  private readonly channel = "pos-events";

  constructor() {
    const appId = process.env.PUSHER_APP_ID;
    const key = process.env.PUSHER_KEY;
    const secret = process.env.PUSHER_SECRET;
    const cluster = process.env.PUSHER_CLUSTER;

    if (!appId || !key || !secret || !cluster) {
      this.pusher = null;
      this.logger.warn(
        "PUSHER_* env not set — realtime events disabled (no-op)",
      );
      return;
    }

    this.pusher = new Pusher({
      appId,
      key,
      secret,
      cluster,
      useTLS: true,
    });
    this.logger.log(
      `Pusher initialized (cluster=${cluster}, channel=${this.channel})`,
    );
  }

  /**
   * Fire-and-forget event broadcast. Non-blocking — never throws.
   * Errors logged but tidak break flow operasi utama.
   */
  emit(
    event: AppEventName | string,
    data?: Record<string, unknown> | unknown,
    branchId?: string,
  ): void {
    if (!this.pusher) return;
    const payload = {
      ...(data && typeof data === "object" ? (data as Record<string, unknown>) : {}),
      branchId: branchId ?? undefined,
      timestamp: Date.now(),
    };
    this.pusher.trigger(this.channel, event, payload).catch((err) => {
      this.logger.error(
        `Failed to emit "${event}": ${err instanceof Error ? err.message : err}`,
      );
    });
  }
}

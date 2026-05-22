// Mirror dari schema wa-service.
// Sinkron dengan D:\pribadi\wa-service\backend\src\modules.

export type WaServiceSessionStatus =
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED";

export type WaServiceSessionStage =
  | "IDLE"
  | "PREPARING"
  | "QR_READY"
  | "SCANNED"
  | "SYNCING"
  | "CONNECTED"
  | "FAILED";

export type WaServiceSession = {
  status: WaServiceSessionStatus;
  stage: WaServiceSessionStage;
  phoneNumber: string | null;
  deviceName: string | null;
  qrCode: string | null;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  lastError: string | null;
};

export type WaServiceTenant = {
  id: string;
  name: string;
  apiKeyLast4: string;
  status: "ACTIVE" | "SUSPENDED";
  inboundWebhookUrl: string | null;
  sessionWebhookUrl: string | null;
  toolsWebhookUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WaServiceCreatedTenant = WaServiceTenant & {
  apiKey: string;
  webhookSecret: string;
};

export type WaServiceSendTextResult = {
  messageId: string;
  providerMessageId: string | null;
  status: string;
};

export type WaServiceInboundEvent = {
  fromNumber: string;
  remoteJid: string;
  content: string | null;
  isGroup: boolean;
  providerMessageId: string | null;
  fromMe?: boolean;
};

export type WaServiceEventEnvelope<T> = {
  event: "INBOUND_MESSAGE" | "SESSION_UPDATED" | "TOOL_CALL";
  tenantId: string;
  timestamp: number;
  data: T;
};

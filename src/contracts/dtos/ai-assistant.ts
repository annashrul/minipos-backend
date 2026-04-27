import { z } from "zod";

export const AiChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});
export type AiChatMessageDto = z.infer<typeof AiChatMessageSchema>;

export const AiChatRequestSchema = z.object({
  messages: z.array(AiChatMessageSchema).min(1),
});
export type AiChatRequestDto = z.infer<typeof AiChatRequestSchema>;

export type AiChatResponse = {
  response?: string;
  error?: string;
};

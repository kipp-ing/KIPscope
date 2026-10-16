import type { ApiError } from "@kipscope/shared";
import type { FastifyReply } from "fastify";
import type { z } from "zod";

export function apiError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  extra: Omit<ApiError["error"], "code" | "message"> = {},
) {
  const body: ApiError = { error: { code, message, ...extra } };
  return reply.code(status).send(body);
}

/** Parses request input with a Zod schema; on failure sends 400 and returns undefined. */
export function parseInput<T extends z.ZodType>(
  schema: T,
  input: unknown,
  reply: FastifyReply,
): z.infer<T> | undefined {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const message = result.error.issues
    .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
    .join("; ");
  apiError(reply, 400, "invalid_request", message);
  return undefined;
}

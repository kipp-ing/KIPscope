import type { ApiError, CommandResult } from "@kipscope/shared";
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

/** HTTP status of a command result: 400 invalid command, 503 catalog not loaded, else 422. */
export function commandStatus(result: CommandResult): number {
  if (result.ok) return 200;
  if (result.code === "invalid_command") return 400;
  if (result.code === "catalog_unavailable") return 503;
  return 422;
}

import { z } from "zod";

/** Request-body shape schemas for the control-plane API — see server/auth/schemas.ts for the
 * same "wrap the existing field validator, gain Zod for structure/unknown-key rejection" pattern. */

export const createNodeBodySchema = z.object({ name: z.unknown() }).strict();
export const updateNodeBodySchema = z.object({ name: z.unknown() }).strict();
export const emptyBodySchema = z.object({}).strict();

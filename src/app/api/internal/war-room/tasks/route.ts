import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/shared/logger";
import { describeError } from "@/lib/shared/describe-error";
import { createTask, listTasks } from "@/lib/war-room/store";

export const dynamic = "force-dynamic";

/** GET /api/internal/war-room/tasks: open tasks, then ones finished in the last two weeks. */
export async function GET() {
  try {
    return NextResponse.json(await listTasks());
  } catch (error) {
    logger.error("War Room: listing tasks failed", { error: describeError(error) });
    return NextResponse.json({ error: describeError(error) }, { status: 500 });
  }
}

const bodySchema = z.object({
  title: z.string().trim().min(1, "A task needs a title").max(300),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  priority: z.enum(["high", "medium", "low"]).default("medium"),
});

/** POST /api/internal/war-room/tasks  Body: { title, dueDate?, priority? } */
export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid task" }, { status: 400 });
  }
  try {
    return NextResponse.json(await createTask(parsed.data), { status: 201 });
  } catch (error) {
    logger.error("War Room: adding a task failed", { error: describeError(error) });
    return NextResponse.json({ error: describeError(error) }, { status: 500 });
  }
}

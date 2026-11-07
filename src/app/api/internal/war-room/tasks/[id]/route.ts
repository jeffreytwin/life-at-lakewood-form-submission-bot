import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/shared/logger";
import { describeError } from "@/lib/shared/describe-error";
import { deleteTask, updateTask } from "@/lib/war-room/store";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    done: z.boolean().optional(),
    title: z.string().trim().min(1).max(300).optional(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    priority: z.enum(["high", "medium", "low"]).optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), "Nothing to change");

/** PATCH /api/internal/war-room/tasks/:id  Body: any of { done, title, dueDate, priority } */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid change" }, { status: 400 });
  }
  try {
    const task = await updateTask(id, parsed.data);
    if (!task) return NextResponse.json({ error: "No such task" }, { status: 404 });
    return NextResponse.json(task);
  } catch (error) {
    logger.error("War Room: updating a task failed", { id, error: describeError(error) });
    return NextResponse.json({ error: describeError(error) }, { status: 500 });
  }
}

/** DELETE /api/internal/war-room/tasks/:id */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    if (!(await deleteTask(id))) return NextResponse.json({ error: "No such task" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error("War Room: deleting a task failed", { id, error: describeError(error) });
    return NextResponse.json({ error: describeError(error) }, { status: 500 });
  }
}

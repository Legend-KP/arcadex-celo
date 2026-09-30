import { NextResponse } from "next/server";
import {
  apiErrorResponse,
  unauthorizedResponse,
  verifyAdminRequest,
} from "@/lib/admin-auth";
import { isMissionType } from "@/lib/achievements";
import {
  createMissionOnD1,
  deleteMissionOnD1,
  listMissionsFromD1,
  updateMissionOnD1,
} from "@/lib/d1-achievements";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await verifyAdminRequest(request))) return unauthorizedResponse();
  try {
    const missions = await listMissionsFromD1({ activeOnly: false });
    return NextResponse.json({ missions });
  } catch (err) {
    return apiErrorResponse(err, "Failed to list missions.");
  }
}

export async function POST(request: Request) {
  if (!(await verifyAdminRequest(request))) return unauthorizedResponse();
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const type = body.type;
    if (!isMissionType(type)) {
      return NextResponse.json(
        { error: "type must be score or level." },
        { status: 400 }
      );
    }
    const mission = await createMissionOnD1({
      gameId: String(body.gameId ?? ""),
      title: String(body.title ?? ""),
      type,
      threshold: Number(body.threshold),
      mode:
        body.mode === null || body.mode === undefined
          ? null
          : String(body.mode),
      xpReward: Number(body.xpReward),
      active: body.active !== false,
      sortOrder:
        typeof body.sortOrder === "number" ? body.sortOrder : undefined,
    });
    return NextResponse.json({ mission }, { status: 201 });
  } catch (err) {
    return apiErrorResponse(err, "Failed to create mission.");
  }
}

export async function PATCH(request: Request) {
  if (!(await verifyAdminRequest(request))) return unauthorizedResponse();
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const id = String(body.id ?? "").trim();
    if (!id) {
      return NextResponse.json({ error: "id is required." }, { status: 400 });
    }
    const patch: Parameters<typeof updateMissionOnD1>[1] = {};
    if (typeof body.gameId === "string") patch.gameId = body.gameId;
    if (typeof body.title === "string") patch.title = body.title;
    if (isMissionType(body.type)) patch.type = body.type;
    if (typeof body.threshold === "number") patch.threshold = body.threshold;
    if (body.mode === null) patch.mode = null;
    else if (typeof body.mode === "string") patch.mode = body.mode;
    if (typeof body.xpReward === "number") patch.xpReward = body.xpReward;
    if (typeof body.active === "boolean") patch.active = body.active;
    if (typeof body.sortOrder === "number") patch.sortOrder = body.sortOrder;

    const mission = await updateMissionOnD1(id, patch);
    return NextResponse.json({ mission });
  } catch (err) {
    return apiErrorResponse(err, "Failed to update mission.");
  }
}

export async function DELETE(request: Request) {
  if (!(await verifyAdminRequest(request))) return unauthorizedResponse();
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id")?.trim() ?? "";
    if (!id) {
      return NextResponse.json({ error: "id is required." }, { status: 400 });
    }
    await deleteMissionOnD1(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err, "Failed to delete mission.");
  }
}

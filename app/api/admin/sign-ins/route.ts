import { NextResponse } from "next/server";
import {
  apiErrorResponse,
  unauthorizedResponse,
  verifyAdminRequest,
} from "@/lib/admin-auth";
import { listWalletSignIns } from "@/lib/wallet-signins";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await verifyAdminRequest(request))) return unauthorizedResponse();
  try {
    const signIns = await listWalletSignIns(100);
    return NextResponse.json({ signIns });
  } catch (err) {
    return apiErrorResponse(err, "Failed to list wallet sign-ins.");
  }
}

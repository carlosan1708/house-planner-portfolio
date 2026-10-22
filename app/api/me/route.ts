import { NextResponse } from "next/server";
import { getSessionMember, publicMember } from "@/lib/auth";

export async function GET() {
  const member = await getSessionMember();
  return NextResponse.json({ user: publicMember(member) }, { status: member ? 200 : 401 });
}

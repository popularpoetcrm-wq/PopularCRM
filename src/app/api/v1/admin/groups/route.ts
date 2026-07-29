import { z } from "zod";
import { cookies } from "next/headers";
import { jsonError, jsonOk } from "@/lib/api";
import { getSessionUser, isStaff } from "@/lib/auth";
import { createGroup, getExtendedDemo } from "@/lib/demo-ops";
import type { BrandId } from "@/lib/brands";

export async function GET() {
  const user = await getSessionUser();
  if (!user || !isStaff(user.roles)) return jsonError("Forbidden", 403);
  const jar = await cookies();
  const tab = (jar.get("admin_brand_tab")?.value as BrandId) || "poet";
  const state = getExtendedDemo();
  return jsonOk(state.groups.filter((g) => g.brand_id === tab));
}

const schema = z.object({
  title: z.string().min(2),
  capacity: z.coerce.number().int().positive().optional(),
  teacher_name: z.string().optional(),
});

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || !isStaff(user.roles)) return jsonError("Forbidden", 403);
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return jsonError("Invalid payload");
  const jar = await cookies();
  const brandId = (jar.get("admin_brand_tab")?.value as BrandId) || "poet";
  const group = createGroup({
    brand_id: brandId,
    ...parsed.data,
    actor: user.fullName,
  });
  return jsonOk(group);
}

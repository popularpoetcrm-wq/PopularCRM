import { cookies } from "next/headers";
import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { getSessionUser, isStaff } from "@/lib/auth";
import { createGroup, getExtendedDemo, setDemoGroupStatus } from "@/lib/demo-ops";
import { hasSupabase } from "@/lib/env";
import { listGroupsDb, setGroupStatusDb } from "@/lib/supabase-data";
import type { BrandId } from "@/lib/brands";
import { getAdminClient } from "@/lib/supabase/admin";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user || !isStaff(user.roles)) return jsonError("Forbidden", 403);
  const jar = await cookies();
  const tab = (jar.get("admin_brand_tab")?.value as BrandId) || "poet";
  const includeInactive = new URL(req.url).searchParams.get("all") === "1";

  if (hasSupabase() && user.mode === "supabase") {
    try {
      return jsonOk(await listGroupsDb(user.tenantId, tab, { includeInactive }));
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : "fail", 500);
    }
  }

  const groups = getExtendedDemo()
    .groups.filter((g) => g.brand_id === tab)
    .filter((g) => includeInactive || (g.status ?? "active") === "active")
    .map((g) => ({ ...g, status: g.status ?? "active" }));
  return jsonOk(groups);
}

const createSchema = z.object({
  title: z.string().min(2),
  capacity: z.coerce.number().int().positive().optional(),
  teacher_name: z.string().optional(),
  direction: z
    .enum(["impro", "acting", "school", "kids", "show", "playback", "other"])
    .optional(),
});

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || !isStaff(user.roles)) return jsonError("Forbidden", 403);
  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) return jsonError("Invalid payload");
  const jar = await cookies();
  const brandId = (jar.get("admin_brand_tab")?.value as BrandId) || "poet";

  if (hasSupabase() && user.mode === "supabase") {
    const db = getAdminClient();
    const { data, error } = await db
      .from("groups")
      .insert({
        tenant_id: user.tenantId,
        title: parsed.data.title,
        capacity: parsed.data.capacity ?? 12,
        brand_id: brandId,
        status: "active",
        direction: parsed.data.direction ?? null,
      })
      .select("id, title, capacity, brand_id, status, direction")
      .single();
    if (error) return jsonError(error.message, 400);
    return jsonOk({
      id: data.id,
      brand_id: data.brand_id ?? brandId,
      title: data.title,
      capacity: data.capacity ?? 12,
      status: data.status ?? "active",
      direction: data.direction ?? null,
      teacher_name: parsed.data.teacher_name ?? "—",
    });
  }

  const group = createGroup({
    brand_id: brandId,
    ...parsed.data,
    actor: user.fullName,
  });
  return jsonOk({ ...group, status: "active" });
}

const patchSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["active", "archived"]),
});

export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user || !isStaff(user.roles)) return jsonError("Forbidden", 403);
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) return jsonError("Invalid payload");

  if (hasSupabase() && user.mode === "supabase") {
    try {
      const data = await setGroupStatusDb(parsed.data.id, user.tenantId, parsed.data.status);
      return jsonOk(data);
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : "fail", 400);
    }
  }

  const group = setDemoGroupStatus(parsed.data.id, parsed.data.status, user.fullName);
  if (!group) return jsonError("Group not found", 404);
  return jsonOk(group);
}

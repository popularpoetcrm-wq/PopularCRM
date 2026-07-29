"use client";

import { useRouter } from "next/navigation";
import { ADMIN_BRAND_TABS, BRANDS, type BrandId } from "@/lib/brands";

export function BrandTabs({ active }: { active: BrandId }) {
  const router = useRouter();

  async function select(id: BrandId) {
    await fetch("/api/v1/admin/brand-tab", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brandId: id }),
    });
    router.refresh();
  }

  return (
    <div className="brand-tabs" role="tablist" aria-label="Brand">
      {ADMIN_BRAND_TABS.map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          className="brand-tab"
          data-active={active === id}
          onClick={() => select(id)}
        >
          {BRANDS[id].shortName}
        </button>
      ))}
    </div>
  );
}

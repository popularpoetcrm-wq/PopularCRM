import type { PackagePlanSnapshot } from "@/lib/types/domain";
import type { BrandId } from "@/lib/brands";
import { loadPersistedDemo, savePersistedDemo } from "@/lib/demo-persist";

export const DEMO_TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

export type OnboardingStatus = "draft" | "invited" | "activated" | "complete";

export type DemoPerson = {
  id: string;
  full_name: string;
  email: string;
  phone?: string;
  roles: string[];
  tshirt_size?: string;
  birth_date?: string;
  is_minor?: boolean;
  onboarding_status?: OnboardingStatus;
  invited_at?: string;
  activated_at?: string;
  accepted_rules_at?: string;
  telegram_linked?: boolean;
};

export type DemoState = {
  persons: DemoPerson[];
  groups: Array<{
    id: string;
    brand_id: BrandId;
    title: string;
    capacity: number;
    teacher_name: string;
    status?: "active" | "archived";
  }>;
  enrollments: Array<{
    id: string;
    brand_id: BrandId;
    student_person_id: string;
    group_id: string;
    status: string;
  }>;  packages: Array<{
    id: string;
    enrollment_id: string;
    status: string;
    credits_available: number;
    credits_total: number;
    expires_at: string;
    plan: PackagePlanSnapshot;
  }>;
  makeups: Array<{
    id: string;
    student_person_id: string;
    status: string;
    valid_until: string;
    target_session_id?: string;
    booked_at?: string;
  }>;
  payments: Array<{
    id: string;
    brand_id: BrandId;
    payer_person_id: string;
    enrollment_id: string;
    amount: number;
    amount_paid: number;
    status: string;
    payment_method: string;
    description: string;
    payment_url?: string;
    product_kind?: import("@/lib/brands").ProductKind;
    created_at: string;
  }>;
  invoices: Array<{
    id: string;
    payment_id: string;
    status: string;
    invoice_number?: string;
    pdf_url?: string;
  }>;
  sessions: Array<{
    id: string;
    group_id: string;
    title: string;
    starts_at: string;
    status: string;
  }>;
  attendance: Array<{
    id: string;
    session_id: string;
    student_person_id: string;
    status: string;
  }>;
};

const plan: PackagePlanSnapshot = {
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  name: "Pakiet 4 zajęć",
  lessons_count: 4,
  validity_days: 60,
  price_gross: 400,
  currency: "PLN",
  start_policy: "on_payment",
  makeup_policy: "ALWAYS_CREATE_ON_ABSENCE",
  makeup_validity_days: 30,
  booking_cutoff_minutes: 360,
};

function createInitialState(): DemoState {
  const inTwoDays = new Date(Date.now() + 2 * 24 * 3600 * 1000);
  inTwoDays.setHours(18, 0, 0, 0);
  const kidsSession = new Date(Date.now() + 3 * 24 * 3600 * 1000);
  kidsSession.setHours(16, 0, 0, 0);

  return {
    persons: [
      {
        id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        full_name: "Admin Studio",
        email: "admin@studio.local",
        roles: ["admin", "teacher"],
        onboarding_status: "complete",
      },
      {
        id: "teacher-0000-0000-0000-000000000001",
        full_name: "Teacher Impro",
        email: "teacher@studio.local",
        roles: ["teacher"],
        onboarding_status: "complete",
      },
      {
        id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
        full_name: "Anna Kowalska",
        email: "anna@example.com",
        phone: "+48222222222",
        roles: ["student", "payer"],
        tshirt_size: "M",
        birth_date: "1995-04-12",
        onboarding_status: "complete",
        accepted_rules_at: new Date().toISOString(),
        telegram_linked: true,
      },
      {
        id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
        full_name: "Jan Nowak",
        email: "jan@example.com",
        roles: ["student"],
        tshirt_size: "L",
        birth_date: "2008-09-01",
        is_minor: true,
        onboarding_status: "complete",
      },
      {
        id: "kidparent-0000-0000-0000-000000000001",
        full_name: "Maria Nowak",
        email: "maria@example.com",
        roles: ["parent", "payer"],
        onboarding_status: "complete",
        accepted_rules_at: new Date().toISOString(),
      },
    ],
    groups: [
      {
        id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
        brand_id: "poet",
        title: "Środa 18:00 — Impro",
        capacity: 12,
        teacher_name: "Admin Studio",
      },
      {
        id: "kidsgroup-ffff-ffff-ffff-ffffffffff",
        brand_id: "kids",
        title: "Sobota 16:00 — Kids Scene",
        capacity: 10,
        teacher_name: "Admin Studio",
      },
    ],
    enrollments: [
      {
        id: "11111111-1111-1111-1111-111111111111",
        brand_id: "poet",
        student_person_id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
        group_id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
        status: "active",
      },
      {
        id: "22222222-2222-2222-2222-222222222222",
        brand_id: "poet",
        student_person_id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
        group_id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
        status: "active",
      },
      {
        id: "33333333-3333-3333-3333-333333333333",
        brand_id: "kids",
        student_person_id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
        group_id: "kidsgroup-ffff-ffff-ffff-ffffffffff",
        status: "active",
      },
    ],
    packages: [
      {
        id: "pkg-anna-1",
        enrollment_id: "11111111-1111-1111-1111-111111111111",
        status: "active",
        credits_available: 3,
        credits_total: 4,
        expires_at: new Date(Date.now() + 45 * 24 * 3600 * 1000).toISOString(),
        plan,
      },
    ],
    makeups: [
      {
        id: "makeup-1",
        student_person_id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
        status: "available",
        valid_until: new Date(Date.now() + 20 * 24 * 3600 * 1000).toISOString(),
      },
    ],
    payments: [
      {
        id: "pay-1",
        brand_id: "poet",
        payer_person_id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
        enrollment_id: "11111111-1111-1111-1111-111111111111",
        amount: 400,
        amount_paid: 400,
        status: "paid",
        payment_method: "online",
        description: "Pakiet 4 zajęć — Środa 18:00",
        created_at: new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString(),
      },
      {
        id: "pay-2",
        brand_id: "poet",
        payer_person_id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
        enrollment_id: "22222222-2222-2222-2222-222222222222",
        amount: 400,
        amount_paid: 200,
        status: "partial",
        payment_method: "cash",
        description: "Pakiet 4 zajęć — częściowa wpłata",
        created_at: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
      },
      {
        id: "pay-kids-1",
        brand_id: "kids",
        payer_person_id: "kidparent-0000-0000-0000-000000000001",
        enrollment_id: "33333333-3333-3333-3333-333333333333",
        amount: 320,
        amount_paid: 0,
        status: "pending",
        payment_method: "online",
        description: "Kids — pakiet 4 zajęć",
        created_at: new Date().toISOString(),
      },
    ],
    invoices: [],
    sessions: [
      {
        id: "sess-1",
        group_id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
        title: "Środa 18:00 — Impro",
        starts_at: inTwoDays.toISOString(),
        status: "scheduled",
      },
      {
        id: "sess-kids-1",
        group_id: "kidsgroup-ffff-ffff-ffff-ffffffffff",
        title: "Sobota 16:00 — Kids Scene",
        starts_at: kidsSession.toISOString(),
        status: "scheduled",
      },
    ],
    attendance: [],
  };
}

const g = globalThis as unknown as {
  __studioDemo?: DemoState;
  __studioDemoPersistTimer?: ReturnType<typeof setTimeout>;
};

function schedulePersist() {
  if (g.__studioDemoPersistTimer) clearTimeout(g.__studioDemoPersistTimer);
  g.__studioDemoPersistTimer = setTimeout(() => {
    if (g.__studioDemo) savePersistedDemo(g.__studioDemo);
  }, 400);
}

/** Mutate state then call this (or use getDemoState which auto-schedules on write via proxy — manual). */
export function touchDemoState() {
  schedulePersist();
}

export function getDemoState(): DemoState {
  if (!g.__studioDemo) {
    const loaded = loadPersistedDemo<DemoState>();
    g.__studioDemo =
      loaded && Array.isArray(loaded.persons) && loaded.persons.length
        ? loaded
        : createInitialState();
  }
  return g.__studioDemo;
}

export function resetDemoState() {
  g.__studioDemo = createInitialState();
  savePersistedDemo(g.__studioDemo);
}

export function filterGroupsByBrand(brandId: string) {
  return getDemoState().groups.filter((g) => g.brand_id === brandId);
}

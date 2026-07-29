export type Role =
  | "student"
  | "parent"
  | "payer"
  | "teacher"
  | "admin"
  | "owner"
  | "accounting";

export type PersonStatus =
  | "started"
  | "completed"
  | "cancelled"
  | "expired"
  | "suspended"
  | "archived";

export type AttendanceStatus =
  | "present"
  | "absent"
  | "absent_notified"
  | "cancelled_by_studio";

export type CreditStatus = "available" | "consumed" | "expired" | "void";
export type MakeupStatus = "available" | "booked" | "used" | "expired" | "burned";
export type PaymentStatus =
  | "pending"
  | "paid"
  | "failed"
  | "refunded"
  | "cancelled"
  | "partial";
export type PaymentMethod = "online" | "cash" | "transfer" | "invoice";
export type InvoiceStatus =
  | "requested"
  | "queued"
  | "sent_to_saldeo"
  | "issued"
  | "failed"
  | "cancelled";

export interface PackagePlanSnapshot {
  id: string;
  name: string;
  lessons_count: number;
  validity_days: number;
  price_gross: number;
  currency: string;
  start_policy: "on_payment" | "on_first_attendance" | "custom_start_date";
  makeup_policy: "ALWAYS_CREATE_ON_ABSENCE" | "ONLY_IF_NOTIFIED" | "NEVER";
  makeup_validity_days: number;
  booking_cutoff_minutes: number;
}

export interface BulkAttendanceItem {
  enrollmentId: string;
  studentPersonId: string;
  attendanceType: "regular" | "makeup";
  status: AttendanceStatus;
  comment?: string | null;
}

export type Role = 'SuperAdmin' | 'OrgAdmin' | 'Paralegal' | 'Attorney' | 'Finance' | 'FRONT_DESK';

export interface Organization {
  id: string;
  name: string;
  phone_number?: string | null;
  location?: string | null;
  logo_data_url?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  phone_number?: string | null;
  address?: string | null;
  profile_photo_data_url?: string | null;
  password_hash?: string;
  role: Role;
  organization_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type PaymentStatus = 'Paid' | 'Not Paid';
export type ShipmentStatus = 'Draft' | 'Submitted' | 'In Transit' | 'Delivered';

export interface Shipment {
  id: string;
  organization_id: string;
  beneficiary_name: string;
  petitioner_name: string;
  tracking_number: string;
  case_type_id: string;
  service_center_id: string;
  service_type_id: string;
  mail_delivery_type_id: string;
  courier_service_id: string;
  ship_date: string;
  tracking_group_id: string | null;
  // Legacy compatibility for pre-migration records.
  fedex_service_type?: string;
  effective_tracking_number?: string;
  individual_tracking_number?: string;
  group_tracking_number?: string;
  tva_payment: boolean;
  payment_status: PaymentStatus;
  attorney_id: string;
  paralegal_id: string;
  notes: string;
  invoice_number: string;
  status: ShipmentStatus;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
  is_deleted: boolean;
}

export interface DropdownItem {
  id: string;
  organization_id: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

export type AuditActionType = 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'ROLE_CHANGE' | 'ORG_CHANGE';

export interface AuditLog {
  id: string;
  entity_type: string;
  entity_id: string;
  action_type: AuditActionType;
  old_value: string | null;
  new_value: string | null;
  performed_by: string;
  performed_by_name: string;
  organization_id: string | null;
  timestamp: string;
}

export interface AuthState {
  user: User | null;
  token: string | null;
}

export interface ShipmentFilters {
  search: string;
  caseType: string;
  serviceCenter: string;
  courierService: string;
  serviceType: string;
  attorney: string;
  paymentStatus: string;
  status: string;
  shipDate: string;
  dateFrom: string;
  dateTo: string;
  page: number;
  pageSize: number;
  sortBy: string;
  sortDir: 'asc' | 'desc';
}

export type TimeActionType = 'IN' | 'OUT';
export type TimesheetStatus = 'Draft' | 'Pending Approval' | 'Approved' | 'Rejected';

export interface TimeEntry {
  id: string;
  organization_id: string;
  user_id: string;
  action_type: TimeActionType;
  occurred_at_utc: string;
  local_date: string;
  timezone: string;
  ip_address?: string | null;
  device_info?: string | null;
  created_at: string;
  created_by?: string | null;
}

export interface TimeSession {
  in_entry_id: string;
  out_entry_id: string | null;
  clock_in_at_utc: string;
  clock_out_at_utc: string | null;
  local_date: string;
  duration_seconds: number;
  is_open: boolean;
}

export interface TimeStationStatusPayload {
  now_utc: string;
  timezone: string;
  local_date: string;
  is_clocked_in: boolean;
  active_session_started_at_utc: string | null;
  active_work_seconds: number;
  forgot_clock_out_alert: boolean;
  forgot_clock_out_from_date: string | null;
  recent_entries: TimeEntry[];
  today: {
    local_date: string;
    clock_in_count: number;
    clock_out_count: number;
    completed_work_seconds: number;
    total_work_seconds: number;
    remaining_clock_ins: number;
    remaining_clock_outs: number;
    max_actions: number;
  };
}

export interface TimeHistoryResponse {
  timezone: string;
  date_from: string;
  date_to: string;
  entries: TimeEntry[];
  sessions: TimeSession[];
  daily: Array<{
    local_date: string;
    clock_in_count: number;
    clock_out_count: number;
    completed_work_seconds: number;
    active_work_seconds: number;
    total_work_seconds: number;
  }>;
}

export interface TimesheetRow {
  id: string;
  organization_id: string;
  user_id: string;
  week_start: string;
  week_end: string;
  timezone: string;
  status: TimesheetStatus;
  submitted_at: string | null;
  submitted_by: string | null;
  admin_reviewed_at: string | null;
  admin_reviewed_by: string | null;
  admin_comment: string | null;
  forwarded_to_finance: boolean;
  finance_forwarded_at: string | null;
  finance_forwarded_by: string | null;
  created_at: string;
  updated_at: string;
  user_name?: string;
  user_email?: string;
  user_role?: string;
  admin_reviewer_name?: string;
  completed_work_seconds: number;
  active_work_seconds: number;
  total_work_seconds: number;
  days_worked: number;
  clock_in_count: number;
  clock_out_count: number;
}

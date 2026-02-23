
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import apiClient from '../api/client';
import type { Shipment, ShipmentFilters, PaymentStatus, ShipmentStatus } from '../types';
import { Modal, ConfirmModal } from '../components/ui/Modal';
import {
  Plus, Search, Filter, Edit2, Trash2, Download, ChevronUp, ChevronDown,
  ChevronLeft, ChevronRight, X, AlertCircle, Eye, Save, RefreshCw, Send, CheckCircle2
} from 'lucide-react';

type FieldProps = {
  label: string;
  name: string;
  children: React.ReactNode;
  required?: boolean;
  errors?: Record<string, string>;
};

interface FrontDeskShipmentRow {
  id: string;
  beneficiary_name: string;
  petitioner_name: string;
  status: string;
  created_by: string;
  created_by_name: string;
  tracking_number: string;
  individual_tracking_number: string;
  group_tracking_number: string;
}

interface FrontDeskGroup {
  group_id: string | null;
  ship_date: string;
  service_center_id: string;
  courier_service_id: string;
  service_type_id: string;
  mail_delivery_type_id: string;
  group_tracking_number: string;
  created_by: string | null;
  created_by_name: string;
  tracking_assigned_by: string | null;
  tracking_assigned_by_name: string;
  updated_at: string | null;
  total_packets: number;
  tracked_packets: number;
  untracked_packets: number;
  submitted_packets: number;
  ready_to_submit_packets: number;
  shipments: FrontDeskShipmentRow[];
}

interface FrontDeskMemberSummary {
  user_id: string | null;
  user_name: string;
  submitted_packets: number;
  total_packets: number;
}

function Field({ label, name, children, required = true, errors = {} }: FieldProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
      {errors[name] && <p className="text-xs text-red-500 mt-1">{errors[name]}</p>}
    </div>
  );
}

function groupKey(group: FrontDeskGroup) {
  return `${group.group_id || 'nogroup'}|${group.ship_date}|${group.service_center_id}|${group.mail_delivery_type_id || ''}|${group.courier_service_id}|${group.service_type_id}`;
}

function getPendingSubmitStats(rows: FrontDeskShipmentRow[]) {
  const pendingRows = rows.filter((row) => row.status === 'Draft' || row.status === 'Submitted');
  const missingTrackingCount = pendingRows.filter((row) => !(row.tracking_number || '').trim()).length;
  return {
    pendingCount: pendingRows.length,
    missingTrackingCount,
    readyCount: pendingRows.length - missingTrackingCount,
  };
}

export function ShipmentsPage() {
  const { user, hasRole } = useAuth();
  const orgId = user?.organization_id || '';
  const isSuperAdmin = hasRole('SuperAdmin');
  const isFinance = hasRole('Finance');
  const isAttorney = hasRole('Attorney');
  const isParalegal = hasRole('Paralegal');
  const isFrontDeskUser = hasRole('FRONT_DESK');
  const isFrontDeskOnly = isFrontDeskUser && !hasRole('SuperAdmin', 'OrgAdmin');
  const canManageTracking = hasRole('SuperAdmin', 'OrgAdmin', 'FRONT_DESK');
  const showFrontDeskDashboard = canManageTracking && !!orgId;
  const canCreate = hasRole('SuperAdmin', 'OrgAdmin', 'Paralegal', 'FRONT_DESK', 'Attorney');
  const canEdit = hasRole('SuperAdmin', 'OrgAdmin', 'FRONT_DESK');
  const canBulkDelete = hasRole('SuperAdmin', 'OrgAdmin', 'FRONT_DESK', 'Paralegal');

  const [filters, setFilters] = useState<ShipmentFilters>({
    search: '',
    caseType: '',
    serviceCenter: '',
    courierService: '',
    serviceType: '',
    attorney: '',
    paymentStatus: '',
    status: '',
    shipDate: '',
    dateFrom: '',
    dateTo: '',
    page: 1,
    pageSize: 15,
    sortBy: 'created_at',
    sortDir: 'desc',
  });
  const [showFilters, setShowFilters] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingShipment, setEditingShipment] = useState<Shipment | null>(null);
  const [viewingShipment, setViewingShipment] = useState<Shipment | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selectedShipmentIds, setSelectedShipmentIds] = useState<string[]>([]);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [shipmentsData, setShipmentsData] = useState<{ data: Shipment[]; total: number }>({ data: [], total: 0 });
  const [serviceCenters, setServiceCenters] = useState<import('../types').DropdownItem[]>([]);
  const [caseTypes, setCaseTypes] = useState<import('../types').DropdownItem[]>([]);
  const [mailDeliveryTypes, setMailDeliveryTypes] = useState<import('../types').DropdownItem[]>([]);
  const [courierServices, setCourierServices] = useState<import('../types').DropdownItem[]>([]);
  const [serviceTypes, setServiceTypes] = useState<import('../types').DropdownItem[]>([]);
  const [orgUsers, setOrgUsers] = useState<import('../types').User[]>([]);
  const [frontDeskDate, setFrontDeskDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [frontDeskGroups, setFrontDeskGroups] = useState<FrontDeskGroup[]>([]);
  const [frontDeskMemberSummary, setFrontDeskMemberSummary] = useState<FrontDeskMemberSummary[]>([]);
  const [frontDeskError, setFrontDeskError] = useState('');
  const [loadingFrontDeskGroups, setLoadingFrontDeskGroups] = useState(false);
  const [submittingCenter, setSubmittingCenter] = useState(false);
  const [submittingGroupKey, setSubmittingGroupKey] = useState<string | null>(null);
  const [submittingShipmentId, setSubmittingShipmentId] = useState<string | null>(null);
  const [expandedGroupKey, setExpandedGroupKey] = useState<string | null>(null);
  const [bulkTrackingDrafts, setBulkTrackingDrafts] = useState<Record<string, string>>({});
  const [groupTrackingEditOpen, setGroupTrackingEditOpen] = useState<Record<string, boolean>>({});
  const [individualTrackingDrafts, setIndividualTrackingDrafts] = useState<Record<string, string>>({});
  const [overrideDraftOpen, setOverrideDraftOpen] = useState<Record<string, boolean>>({});
  const [frontDeskLoadedAt, setFrontDeskLoadedAt] = useState<string>('');
  const [activeFrontDeskCenterId, setActiveFrontDeskCenterId] = useState<string>('');

  const effectiveOrgId = isSuperAdmin ? null : orgId;
  const refresh = () => setRefreshKey(k => k + 1);

  useMemo(() => {}, [/* no-op */]);

  const getTrackingNumber = (shipment: Shipment) =>
    shipment.effective_tracking_number || shipment.tracking_number || shipment.group_tracking_number || '-';

  const hasAssignedTracking = (shipment: Shipment) => {
    const individual = (shipment.individual_tracking_number || shipment.tracking_number || '').trim();
    const group = (shipment.group_tracking_number || '').trim();
    const effective = (shipment.effective_tracking_number || '').trim();
    return !!(individual || group || effective);
  };

  const canParalegalManageShipment = (shipment: Shipment) =>
    isParalegal
    && (shipment.attorney_id === user?.id || shipment.paralegal_id === user?.id || shipment.created_by === user?.id)
    && !hasAssignedTracking(shipment);

  const canAssignedUserEditShipment = (shipment: Shipment) =>
    (shipment.attorney_id === user?.id || shipment.paralegal_id === user?.id) && !hasAssignedTracking(shipment);

  const canEditShipment = (shipment: Shipment) =>
    (((canEdit || isFinance) && !isAttorney) || canAssignedUserEditShipment(shipment));

  const canDeleteShipment = (shipment: Shipment) =>
    (canEdit || canParalegalManageShipment(shipment));

  const getServiceCenterName = (id?: string | null) =>
    serviceCenters.find(c => c.id === id)?.name || '-';

  const getCourierName = (id?: string | null) =>
    courierServices.find(c => c.id === id)?.name || '-';

  const getServiceTypeName = (id?: string | null) =>
    serviceTypes.find(c => c.id === id)?.name || '-';

  const getMailDeliveryTypeName = (id?: string | null) =>
    mailDeliveryTypes.find(c => c.id === id)?.name || '-';

  const getUserName = (id?: string) => {
    if (!id) return '-';
    return orgUsers.find(u => u.id === id)?.name || id.slice(0, 8);
  };

  const loadData = async () => {
    try {
      const qs = new URLSearchParams();
      if (effectiveOrgId) qs.set('organizationId', effectiveOrgId);
      Object.entries(filters).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
      });

      const res = await apiClient.authFetch(`/shipments?${qs.toString()}`);
      const d = await res.json();
      setShipmentsData(d);

      if (orgId) {
        const [sc, ct, md, cs, st, us] = await Promise.all([
          apiClient.authFetch(`/dropdowns/service_centers?organizationId=${orgId}`),
          apiClient.authFetch(`/dropdowns/case_types?organizationId=${orgId}`),
          apiClient.authFetch(`/dropdowns/mail_delivery_types?organizationId=${orgId}`),
          apiClient.authFetch(`/dropdowns/courier_services?organizationId=${orgId}`),
          apiClient.authFetch(`/dropdowns/service_types?organizationId=${orgId}`),
          apiClient.authFetch(`/users?organizationId=${orgId}`),
        ]);
        setServiceCenters(await sc.json());
        setCaseTypes(await ct.json());
        setMailDeliveryTypes(await md.json());
        setCourierServices(await cs.json());
        setServiceTypes(await st.json());
        setOrgUsers(await us.json());
      }
    } catch (err) {
      console.error('Failed loading shipments', err);
    }
  };

  const loadFrontDeskGroups = async () => {
    if (!showFrontDeskDashboard) return;
    setLoadingFrontDeskGroups(true);
    setFrontDeskError('');
    try {
      const qs = new URLSearchParams();
      qs.set('organizationId', orgId);
      qs.set('date', frontDeskDate);
      const res = await apiClient.authFetch(`/shipments/frontdesk/groups?${qs.toString()}`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error || 'Failed loading Front Desk groups');
      }
      const payload = await res.json();
      const groups = (payload?.groups || []) as FrontDeskGroup[];
      const memberSummary = (payload?.member_summary || []) as FrontDeskMemberSummary[];
      setFrontDeskGroups(groups);
      setFrontDeskMemberSummary(memberSummary);
      setFrontDeskLoadedAt(new Date().toISOString());
      setExpandedGroupKey(prev => {
        if (!groups.length) return null;
        if (prev && groups.some(g => groupKey(g) === prev)) return prev;
        return groupKey(groups[0]);
      });

      const nextBulkDrafts: Record<string, string> = {};
      const nextIndividualDrafts: Record<string, string> = {};
      groups.forEach((g) => {
        const key = groupKey(g);
        nextBulkDrafts[key] = g.group_tracking_number || '';
        g.shipments.forEach((s) => {
          nextIndividualDrafts[s.id] = s.individual_tracking_number || '';
        });
      });
      setBulkTrackingDrafts(nextBulkDrafts);
      setGroupTrackingEditOpen(prev => {
        const next: Record<string, boolean> = {};
        groups.forEach((g) => {
          const key = groupKey(g);
          const hasTracking = !!(g.group_tracking_number || '').trim();
          next[key] = prev[key] ?? !hasTracking;
        });
        return next;
      });
      setIndividualTrackingDrafts(nextIndividualDrafts);
      setOverrideDraftOpen(prev => {
        const next: Record<string, boolean> = {};
        groups.forEach(g => g.shipments.forEach(s => {
          if (prev[s.id]) next[s.id] = true;
        }));
        return next;
      });
    } catch (err: any) {
      setFrontDeskError(err?.message || 'Failed loading Front Desk groups');
      setFrontDeskMemberSummary([]);
    } finally {
      setLoadingFrontDeskGroups(false);
    }
  };

  useEffect(() => { loadData(); }, [effectiveOrgId, filters, refreshKey]);
  useEffect(() => { loadFrontDeskGroups(); }, [showFrontDeskDashboard, frontDeskDate, refreshKey]);

  useEffect(() => {
    if (!isParalegal) return;
    const timer = setInterval(() => setRefreshKey(k => k + 1), 10000);
    return () => clearInterval(timer);
  }, [isParalegal]);

  const attorneys = useMemo(() => orgUsers.filter(u => u.role === 'Attorney'), [orgUsers]);
  const paralegals = useMemo(() => orgUsers.filter(u => u.role === 'Paralegal'), [orgUsers]);
  const frontDeskSummary = useMemo(() => {
    return frontDeskGroups.reduce((acc, g) => {
      acc.totalGroups += 1;
      acc.totalPackets += g.total_packets;
      acc.trackedPackets += g.tracked_packets;
      acc.pendingPackets += g.untracked_packets;
      acc.submittedPackets += g.submitted_packets || 0;
      return acc;
    }, { totalGroups: 0, totalPackets: 0, trackedPackets: 0, pendingPackets: 0, submittedPackets: 0 });
  }, [frontDeskGroups]);
  const frontDeskCenterTabs = useMemo(() => {
    const byCenterAndMail = new Map<string, { id: string; service_center_id: string; mail_delivery_type_id: string; name: string; count: number }>();
    frontDeskGroups.forEach((group) => {
      const tabId = `${group.service_center_id}|${group.mail_delivery_type_id || ''}`;
      const existing = byCenterAndMail.get(tabId);
      if (existing) {
        existing.count += 1;
        return;
      }
      byCenterAndMail.set(tabId, {
        id: tabId,
        service_center_id: group.service_center_id,
        mail_delivery_type_id: group.mail_delivery_type_id || '',
        name: `${getServiceCenterName(group.service_center_id)} / ${getMailDeliveryTypeName(group.mail_delivery_type_id)}`,
        count: 1,
      });
    });
    return Array.from(byCenterAndMail.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [frontDeskGroups, serviceCenters, mailDeliveryTypes]);
  const visibleFrontDeskGroups = useMemo(() => {
    if (!activeFrontDeskCenterId) return frontDeskGroups;
    const [serviceCenterId, mailDeliveryTypeId = ''] = activeFrontDeskCenterId.split('|');
    return frontDeskGroups.filter(g =>
      g.service_center_id === serviceCenterId
      && (g.mail_delivery_type_id || '') === mailDeliveryTypeId
    );
  }, [frontDeskGroups, activeFrontDeskCenterId]);
  const visibleFrontDeskSummary = useMemo(() => {
    return visibleFrontDeskGroups.reduce((acc, g) => {
      acc.totalGroups += 1;
      acc.totalPackets += g.total_packets;
      acc.trackedPackets += g.tracked_packets;
      acc.pendingPackets += g.untracked_packets;
      acc.submittedPackets += g.submitted_packets || 0;
      return acc;
    }, { totalGroups: 0, totalPackets: 0, trackedPackets: 0, pendingPackets: 0, submittedPackets: 0 });
  }, [visibleFrontDeskGroups]);
  const visibleFrontDeskSubmitSummary = useMemo(() => {
    return visibleFrontDeskGroups.reduce((acc, group) => {
      const stats = getPendingSubmitStats(group.shipments);
      acc.pendingPackets += stats.pendingCount;
      acc.missingTrackingPackets += stats.missingTrackingCount;
      acc.readyPackets += stats.readyCount;
      return acc;
    }, { pendingPackets: 0, missingTrackingPackets: 0, readyPackets: 0 });
  }, [visibleFrontDeskGroups]);
  const visibleSubmittedByMember = useMemo(() => {
    const byMember = new Map<string, { key: string; userName: string; submitted: number; total: number }>();
    visibleFrontDeskGroups.forEach((group) => {
      group.shipments.forEach((shipment) => {
        const createdById = (shipment.created_by || '').trim();
        const fallbackName = createdById ? (orgUsers.find(u => u.id === createdById)?.name || createdById.slice(0, 8)) : 'Unknown';
        const userName = (shipment.created_by_name || '').trim() || fallbackName;
        const key = createdById || `name:${userName}`;
        const existing = byMember.get(key) || { key, userName, submitted: 0, total: 0 };
        existing.total += 1;
        if (shipment.status === 'In Transit' || shipment.status === 'Delivered') existing.submitted += 1;
        byMember.set(key, existing);
      });
    });
    const rows = Array.from(byMember.values()).sort((a, b) => {
      if (b.submitted !== a.submitted) return b.submitted - a.submitted;
      return a.userName.localeCompare(b.userName);
    });

    // Fallback to backend summary when rows are empty (should be rare).
    if (!rows.length && frontDeskMemberSummary.length) {
      return frontDeskMemberSummary.map((m, idx) => ({
        key: m.user_id || `summary-${idx}`,
        userName: m.user_name || 'Unknown',
        submitted: Number(m.submitted_packets || 0),
        total: Number(m.total_packets || 0),
      }));
    }
    return rows;
  }, [visibleFrontDeskGroups, orgUsers, frontDeskMemberSummary]);
  const formattedFrontDeskDate = useMemo(() => {
    if (!frontDeskDate) return '-';
    const parsed = new Date(`${frontDeskDate}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return frontDeskDate;
    return parsed.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
  }, [frontDeskDate]);

  useEffect(() => {
    if (!frontDeskCenterTabs.length) {
      setActiveFrontDeskCenterId('');
      return;
    }
    setActiveFrontDeskCenterId((prev) => (
      prev && frontDeskCenterTabs.some(tab => tab.id === prev) ? prev : frontDeskCenterTabs[0].id
    ));
  }, [frontDeskCenterTabs]);

  useEffect(() => {
    if (!visibleFrontDeskGroups.length) {
      setExpandedGroupKey(null);
      return;
    }
    setExpandedGroupKey((prev) => (
      prev && visibleFrontDeskGroups.some(g => groupKey(g) === prev) ? prev : groupKey(visibleFrontDeskGroups[0])
    ));
  }, [visibleFrontDeskGroups]);

  const { data: shipments, total } = shipmentsData;
  const totalPages = Math.ceil(total / filters.pageSize);
  const deletableShipmentIds = useMemo(
    () => shipments.filter(s => canDeleteShipment(s)).map(s => s.id),
    [shipments, canEdit, isParalegal, user?.id],
  );
  const selectedShipmentIdSet = useMemo(
    () => new Set(selectedShipmentIds),
    [selectedShipmentIds],
  );
  const allSelectableOnPageSelected = deletableShipmentIds.length > 0
    && deletableShipmentIds.every(id => selectedShipmentIdSet.has(id));

  useEffect(() => {
    const visibleIds = new Set(shipments.map(s => s.id));
    setSelectedShipmentIds(prev => prev.filter(id => visibleIds.has(id)));
  }, [shipments]);

  const handleSort = (field: string) => {
    setFilters(f => ({
      ...f,
      sortBy: field,
      sortDir: f.sortBy === field && f.sortDir === 'asc' ? 'desc' : 'asc',
      page: 1,
    }));
  };

  const toggleShipmentSelection = (id: string, checked: boolean) => {
    setSelectedShipmentIds(prev => {
      if (checked) {
        if (prev.includes(id)) return prev;
        return [...prev, id];
      }
      return prev.filter(x => x !== id);
    });
  };

  const toggleSelectAllOnPage = (checked: boolean) => {
    setSelectedShipmentIds(prev => {
      const next = new Set(prev);
      if (checked) {
        deletableShipmentIds.forEach(id => next.add(id));
      } else {
        deletableShipmentIds.forEach(id => next.delete(id));
      }
      return Array.from(next);
    });
  };

  const handleDelete = (id: string) => {
    setDeleteId(id);
  };

  const confirmDelete = () => {
    (async () => {
      if (deleteId && user) {
        const res = await apiClient.authFetch(`/shipments/${deleteId}`, { method: 'DELETE' });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          alert(d?.error || 'Failed deleting shipment');
        } else {
          setSelectedShipmentIds(prev => prev.filter(id => id !== deleteId));
        }
        refresh();
      }
      setDeleteId(null);
    })();
  };

  const confirmBulkDelete = async () => {
    if (!selectedShipmentIds.length) return;
    const res = await apiClient.authFetch('/shipments/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ shipment_ids: selectedShipmentIds }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(payload?.error || 'Failed deleting selected shipments');
      return;
    }

    const deletedCount = Number(payload?.deleted_count || 0);
    const skippedCount = Number(payload?.skipped_count || 0);
    setSelectedShipmentIds([]);
    setShowBulkDeleteConfirm(false);
    refresh();

    if (skippedCount > 0) {
      alert(`Deleted ${deletedCount} shipment${deletedCount === 1 ? '' : 's'}. Skipped ${skippedCount} shipment${skippedCount === 1 ? '' : 's'} due to delete rules.`);
    }
  };
  const handleExportCSV = () => {
    (async () => {
      const qs = new URLSearchParams();
      if (effectiveOrgId) qs.set('organizationId', effectiveOrgId);
      Object.entries({ ...filters, page: 1, pageSize: 99999 }).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
      });
      const res = await apiClient.authFetch(`/shipments?${qs.toString()}`);
      const allData = await res.json();
      const headers = [
        'Beneficiary',
        'Petitioner',
        'Tracking #',
        'Case Type',
        'Service Center',
        'Carrier',
        'Service Type',
        'Payment Status',
        'TVA Payment',
        'Invoice Number',
        'Attorney',
        'Paralegal',
        'Status',
        'Created',
      ];
      const rows = allData.data.map((s: Shipment) => [
        s.beneficiary_name,
        s.petitioner_name,
        getTrackingNumber(s),
        caseTypes.find(c => c.id === s.case_type_id)?.name || s.case_type_id,
        serviceCenters.find(c => c.id === s.service_center_id)?.name || s.service_center_id,
        courierServices.find(c => c.id === s.courier_service_id)?.name || s.courier_service_id,
        serviceTypes.find(c => c.id === s.service_type_id)?.name || s.service_type_id,
        s.payment_status,
        s.tva_payment ? 'Yes' : 'No',
        s.invoice_number || '-',
        getUserName(s.attorney_id),
        getUserName(s.paralegal_id),
        s.status,
        new Date(s.created_at).toLocaleDateString(),
      ]);
      const csv = [headers, ...rows].map((r: any[]) => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `shipments_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    })();
  };

  const saveBulkTracking = async (group: FrontDeskGroup) => {
    const key = groupKey(group);
    const trackingNumber = (bulkTrackingDrafts[key] || '').trim();
    if (!trackingNumber) {
      alert('Enter tracking number');
      return;
    }
    try {
      const res = await apiClient.authFetch('/shipments/frontdesk/bulk-tracking', {
        method: 'POST',
        body: JSON.stringify({
          organization_id: orgId,
          ship_date: group.ship_date,
          service_center_id: group.service_center_id,
          courier_service_id: group.courier_service_id,
          service_type_id: group.service_type_id,
          mail_delivery_type_id: group.mail_delivery_type_id,
          tracking_number: trackingNumber,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.details ? `${d?.error || 'Failed applying bulk tracking'}: ${d.details}` : (d?.error || 'Failed applying bulk tracking'));
      }
      setGroupTrackingEditOpen(prev => ({ ...prev, [key]: false }));
      refresh();
    } catch (err: any) {
      alert(err?.message || 'Failed applying bulk tracking');
    }
  };

  const saveIndividualTracking = async (shipmentId: string) => {
    try {
      const res = await apiClient.authFetch(`/shipments/${shipmentId}/tracking`, {
        method: 'PUT',
        body: JSON.stringify({ tracking_number: (individualTrackingDrafts[shipmentId] || '').trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.details ? `${d?.error || 'Failed saving individual tracking'}: ${d.details}` : (d?.error || 'Failed saving individual tracking'));
      }
      refresh();
    } catch (err: any) {
      alert(err?.message || 'Failed saving individual tracking');
    }
  };

  const submitVisibleCenterPackets = async () => {
    const groupsWithPending = visibleFrontDeskGroups.filter((group) => {
      const stats = getPendingSubmitStats(group.shipments);
      return stats.pendingCount > 0;
    });

    if (!groupsWithPending.length) {
      alert('No pending packets to submit for this service center');
      return;
    }

    const missingTrackingPackets = groupsWithPending.reduce((count, group) => {
      const stats = getPendingSubmitStats(group.shipments);
      return count + stats.missingTrackingCount;
    }, 0);

    if (missingTrackingPackets > 0) {
      alert(`Assign tracking number to all pending packets before bulk submit (${missingTrackingPackets} missing)`);
      return;
    }

    setSubmittingCenter(true);
    try {
      let submittedPackets = 0;
      for (const group of groupsWithPending) {
        const res = await apiClient.authFetch('/shipments/frontdesk/submit-group', {
          method: 'POST',
          body: JSON.stringify({
            organization_id: orgId,
            ship_date: group.ship_date,
            service_center_id: group.service_center_id,
            courier_service_id: group.courier_service_id,
            service_type_id: group.service_type_id,
            mail_delivery_type_id: group.mail_delivery_type_id,
          }),
        });

        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d?.details ? `${d?.error || 'Failed submitting selected center packets'}: ${d.details}` : (d?.error || 'Failed submitting selected center packets'));
        }

        const payload = await res.json().catch(() => ({}));
        submittedPackets += Number(payload?.updated_shipments || 0);
      }

      refresh();
      alert(submittedPackets > 0
        ? `Submitted ${submittedPackets} packet${submittedPackets === 1 ? '' : 's'} for selected service center`
        : 'No pending packets were eligible to submit');
    } catch (err: any) {
      alert(err?.message || 'Failed submitting selected center packets');
    } finally {
      setSubmittingCenter(false);
    }
  };

  const submitGroupPackets = async (group: FrontDeskGroup) => {
    const key = groupKey(group);
    setSubmittingGroupKey(key);
    try {
      const res = await apiClient.authFetch('/shipments/frontdesk/submit-group', {
        method: 'POST',
        body: JSON.stringify({
          organization_id: orgId,
          ship_date: group.ship_date,
          service_center_id: group.service_center_id,
          courier_service_id: group.courier_service_id,
          service_type_id: group.service_type_id,
          mail_delivery_type_id: group.mail_delivery_type_id,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.details ? `${d?.error || 'Failed submitting group packets'}: ${d.details}` : (d?.error || 'Failed submitting group packets'));
      }
      refresh();
    } catch (err: any) {
      alert(err?.message || 'Failed submitting group packets');
    } finally {
      setSubmittingGroupKey(null);
    }
  };

  const submitIndividualPacket = async (shipmentId: string) => {
    setSubmittingShipmentId(shipmentId);
    try {
      const res = await apiClient.authFetch(`/shipments/${shipmentId}/submit`, { method: 'PUT' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.details ? `${d?.error || 'Failed submitting packet'}: ${d.details}` : (d?.error || 'Failed submitting packet'));
      }
      refresh();
    } catch (err: any) {
      alert(err?.message || 'Failed submitting packet');
    } finally {
      setSubmittingShipmentId(null);
    }
  };

  const SortIcon = ({ field }: { field: string }) => {
    if (filters.sortBy !== field) return <ChevronUp className="w-3 h-3 text-gray-300" />;
    return filters.sortDir === 'asc' ? <ChevronUp className="w-3 h-3 text-blue-600" /> : <ChevronDown className="w-3 h-3 text-blue-600" />;
  };

  const statusColors: Record<string, string> = {
    Draft: 'bg-gray-100 text-gray-700',
    Submitted: 'bg-blue-100 text-blue-700',
    'In Transit': 'bg-amber-100 text-amber-700',
    Delivered: 'bg-green-100 text-green-700',
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200/80 bg-white/90 px-5 py-4 shadow-[0_12px_28px_-24px_rgba(15,23,42,0.65)] backdrop-blur-sm md:px-6 md:py-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Shipments</h1>
            <p className="mt-1 text-sm text-slate-500">{total} shipment{total !== 1 ? 's' : ''} found</p>
        </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={handleExportCSV}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
            >
              <Download className="w-4 h-4" /> Export CSV
            </button>
            {canCreate && (
              <button
                onClick={() => { setEditingShipment(null); setShowForm(true); }}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
              >
                <Plus className="w-4 h-4" /> New Shipment
              </button>
            )}
          </div>
        </div>
        </div>

      {showFrontDeskDashboard && (
        <div className="rounded-2xl border border-slate-200/80 bg-white/90 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.65)] overflow-hidden backdrop-blur-sm">
          <div className="px-6 py-5 border-b border-slate-200 bg-gradient-to-r from-slate-50 via-blue-50/70 to-cyan-50/70 flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">Front Desk Tracking Center</h2>
            <div className="flex items-center gap-3 text-sm text-slate-700">
              {isFrontDeskOnly && canCreate && (
                <button
                  onClick={() => { setEditingShipment(null); setShowForm(true); }}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-700 text-white font-medium shadow-sm hover:bg-blue-800"
                >
                  <Plus className="w-4 h-4" /> New Shipment
                </button>
              )}
              <button
                onClick={() => refresh()}
                className="inline-flex items-center gap-2 font-medium text-blue-700 hover:text-blue-800"
              >
                <RefreshCw className="w-4 h-4" /> Refresh
              </button>
              <span className="text-slate-300">|</span>
              <button
                onClick={handleExportCSV}
                className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-800"
              >
                <Download className="w-4 h-4" /> Export CSV
              </button>
            </div>
          </div>

          <div className="px-6 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div className="flex items-center gap-3">
              <p className="text-lg font-semibold text-slate-900">{formattedFrontDeskDate}</p>
              <input
                type="date"
                value={frontDeskDate}
                onChange={e => setFrontDeskDate(e.target.value)}
                className="text-sm border border-slate-300 rounded-lg bg-white px-3 py-1.5 outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="inline-flex flex-wrap rounded-lg border border-slate-300 overflow-hidden text-sm shadow-sm">
              <div className="px-4 py-2 bg-blue-700 text-white font-medium">
                {frontDeskSummary.totalGroups} Groups
              </div>
              <div className="px-4 py-2 bg-white text-slate-800 font-medium border-l border-slate-300">
                {frontDeskSummary.totalPackets} Packets
              </div>
              <div className="px-4 py-2 bg-white text-slate-800 font-medium border-l border-slate-300">
                <span className="text-green-700">{frontDeskSummary.submittedPackets}</span> Submitted
              </div>
              <div className="px-4 py-2 bg-white text-slate-800 font-medium border-l border-slate-300">
                <span className="text-amber-600">{frontDeskSummary.pendingPackets}</span> Pending
              </div>
            </div>
          </div>

          {frontDeskCenterTabs.length > 0 && (
            <div className="px-6 py-3 border-b border-slate-200 bg-slate-50/80">
              <div className="inline-flex flex-wrap rounded-lg border border-slate-300 overflow-hidden text-sm">
                {frontDeskCenterTabs.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveFrontDeskCenterId(tab.id)}
                    className={`px-4 py-2 border-r border-slate-300 last:border-r-0 ${activeFrontDeskCenterId === tab.id ? 'bg-blue-700 text-white font-medium' : 'bg-white text-slate-700 hover:bg-slate-100'}`}
                  >
                    {tab.name} ({tab.count})
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="p-4 bg-slate-50/70 space-y-3">
            {frontDeskError && (
              <div className="flex items-center gap-2 p-3 text-sm text-red-700 bg-red-50 rounded-lg border border-red-200">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {frontDeskError}
              </div>
            )}

            {loadingFrontDeskGroups ? (
              <div className="rounded-xl border border-slate-200 bg-white py-10 text-center text-slate-500 text-sm">Loading Front Desk groups...</div>
            ) : visibleFrontDeskGroups.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white py-10 text-center text-slate-500 text-sm">
                {frontDeskGroups.length === 0 ? 'No outgoing packets for the selected date.' : 'No packets for the selected service center.'}
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-slate-500">
                    Showing {visibleFrontDeskSummary.totalGroups} group{visibleFrontDeskSummary.totalGroups !== 1 ? 's' : ''} for {frontDeskCenterTabs.find(t => t.id === activeFrontDeskCenterId)?.name || 'selected center'}.
                    {' '}Submitted: {visibleFrontDeskSummary.submittedPackets}/{visibleFrontDeskSummary.totalPackets}
                  </p>
                  <button
                    onClick={submitVisibleCenterPackets}
                    disabled={
                      submittingCenter
                      || visibleFrontDeskSubmitSummary.pendingPackets === 0
                      || visibleFrontDeskSubmitSummary.missingTrackingPackets > 0
                    }
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg ${
                      !submittingCenter
                      && visibleFrontDeskSubmitSummary.pendingPackets > 0
                      && visibleFrontDeskSubmitSummary.missingTrackingPackets === 0
                        ? 'text-white bg-green-600 hover:bg-green-700'
                        : 'text-gray-500 bg-gray-200 cursor-not-allowed'
                    }`}
                    title={
                      visibleFrontDeskSubmitSummary.pendingPackets === 0
                        ? 'No pending packets to submit'
                        : visibleFrontDeskSubmitSummary.missingTrackingPackets > 0
                          ? `Assign tracking to all pending packets (${visibleFrontDeskSubmitSummary.missingTrackingPackets} missing)`
                          : `Submit ${visibleFrontDeskSubmitSummary.readyPackets} packet${visibleFrontDeskSubmitSummary.readyPackets === 1 ? '' : 's'} in selected center`
                    }
                  >
                    <Send className="w-3.5 h-3.5" />
                    {submittingCenter
                      ? 'Submitting Center...'
                      : `Submit Selected Center (${visibleFrontDeskSubmitSummary.readyPackets})`}
                  </button>
                </div>
                {visibleSubmittedByMember.length > 0 && (
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="text-xs font-medium text-slate-600 mb-2">Submitted Packets By Member</p>
                    <div className="flex flex-wrap gap-2">
                      {visibleSubmittedByMember.map((member) => (
                        <span key={member.key} className="inline-flex items-center gap-2 rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs text-green-800">
                          <span className="font-medium">{member.userName}</span>
                          <span>{member.submitted}/{member.total}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {visibleFrontDeskGroups.map(group => {
                  const key = groupKey(group);
                  const isExpanded = expandedGroupKey === key;
                  const appliedTracking = (bulkTrackingDrafts[key] || group.group_tracking_number || '').trim();
                  const isGroupTrackingEditing = groupTrackingEditOpen[key] ?? !appliedTracking;
                  const packetCountLabel = `${group.total_packets} Packet${group.total_packets === 1 ? '' : 's'}`;
                  const createdByLabel = (group.created_by_name || '').trim()
                    || (group.created_by ? getUserName(group.created_by) : 'Unassigned');
                  const trackingAssignedByLabel = (group.tracking_assigned_by_name || '').trim()
                    || (group.tracking_assigned_by ? getUserName(group.tracking_assigned_by) : (appliedTracking ? 'Unassigned' : 'Not assigned'));
                  const submitStats = getPendingSubmitStats(group.shipments);
                  const groupPendingSubmitCount = submitStats.pendingCount;
                  const groupMissingTrackingCount = submitStats.missingTrackingCount;
                  const groupReadySubmitCount = submitStats.readyCount;
                  const canBulkSubmit = groupReadySubmitCount > 0 && groupMissingTrackingCount === 0;
                  return (
                    <div key={key} className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-[0_10px_24px_-22px_rgba(15,23,42,0.7)]">
                      <div className="px-4 py-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900">
                            {getServiceCenterName(group.service_center_id)} - {getServiceTypeName(group.service_type_id)}
                          </h3>
                          <p className="text-sm text-gray-700 mt-1">
                            {getCourierName(group.courier_service_id)} | {getMailDeliveryTypeName(group.mail_delivery_type_id)} | {packetCountLabel}
                          </p>
                        </div>
                        <button
                          onClick={() => setExpandedGroupKey(prev => prev === key ? null : key)}
                          className="inline-flex items-center gap-3 text-gray-700 hover:text-blue-700 text-sm font-medium"
                        >
                          <span>{packetCountLabel}</span>
                          <span className="text-gray-300">|</span>
                          <span>{group.tracked_packets} Tracked</span>
                          <span className="text-gray-300">|</span>
                          <span className="text-green-700">{group.submitted_packets || 0} Submitted</span>
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      </div>

                      <div className="border-y border-slate-200 bg-slate-50/75">
                        <div className="px-4 py-3 flex items-center justify-between">
                          <span className="text-base font-medium text-gray-900">Tracking</span>
                          <button
                            onClick={() => setExpandedGroupKey(prev => prev === key ? null : key)}
                            className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-700 hover:text-blue-800"
                          >
                            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            {isExpanded ? 'Collapse' : 'Expand'}
                          </button>
                        </div>
                        <div className="px-4 pb-4">
                          {isGroupTrackingEditing ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                type="text"
                                value={bulkTrackingDrafts[key] || ''}
                                onChange={e => setBulkTrackingDrafts(prev => ({ ...prev, [key]: e.target.value }))}
                                placeholder="Assign tracking number"
                                className="w-full sm:w-80 px-3 py-2 text-sm border rounded-lg outline-none focus:ring-2 focus:ring-blue-500 border-gray-300 bg-white"
                              />
                              <button
                                onClick={() => saveBulkTracking(group)}
                                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800"
                              >
                                <Save className="w-3.5 h-3.5" /> Save
                              </button>
                              {appliedTracking && (
                                <button
                                  onClick={() => {
                                    setBulkTrackingDrafts(prev => ({ ...prev, [key]: appliedTracking }));
                                    setGroupTrackingEditOpen(prev => ({ ...prev, [key]: false }));
                                  }}
                                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                                >
                                  <X className="w-3.5 h-3.5" /> Cancel
                                </button>
                              )}
                            </div>
                          ) : (
                            <div className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5">
                              <span className="text-xs text-gray-600">Tracking #</span>
                              <span className="font-mono text-sm font-semibold text-blue-800">{appliedTracking}</span>
                              <button
                                onClick={() => setGroupTrackingEditOpen(prev => ({ ...prev, [key]: true }))}
                                className="p-1 text-blue-700 hover:text-blue-900 rounded"
                                title="Edit tracking number"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                          <div className="mt-2">
                            <button
                              onClick={() => submitGroupPackets(group)}
                              disabled={!canBulkSubmit || submittingGroupKey === key}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg ${
                                canBulkSubmit
                                  ? 'text-white bg-green-600 hover:bg-green-700'
                                  : 'text-gray-500 bg-gray-200 cursor-not-allowed'
                              }`}
                              title={
                                canBulkSubmit
                                  ? `Submit ${groupReadySubmitCount} packet${groupReadySubmitCount === 1 ? '' : 's'}`
                                  : groupPendingSubmitCount === 0
                                    ? 'No pending packets to submit'
                                    : `Assign tracking to all pending packets (${groupMissingTrackingCount} missing)`
                              }
                            >
                              <Send className="w-3.5 h-3.5" />
                              {submittingGroupKey === key ? 'Submitting...' : `Submit Packets (${groupReadySubmitCount})`}
                            </button>
                          </div>
                          <div className="mt-3">
                            {appliedTracking ? (
                              <span className="inline-flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-2.5 py-1 text-sm text-green-800">
                                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-green-600 text-white text-[10px]">OK</span>
                                {appliedTracking} applied to {group.total_packets} packet{group.total_packets === 1 ? '' : 's'}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-sm text-amber-800">
                                <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
                                Tracking not assigned yet
                              </span>
                            )}
                            {groupMissingTrackingCount > 0 && (
                              <p className="mt-1 text-xs text-amber-700">
                                {groupMissingTrackingCount} pending packet{groupMissingTrackingCount === 1 ? '' : 's'} still need tracking before bulk submit.
                              </p>
                            )}
                          </div>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="divide-y divide-gray-200">
                          {group.shipments.map(s => {
                            const packetTracking = (s.tracking_number || '').trim();
                            const trackingSource = s.individual_tracking_number ? 'Using Individual Tracking:' : appliedTracking ? 'Using Group Tracking:' : 'Tracking:';
                            const canSubmitIndividual = !!packetTracking && (s.status === 'Draft' || s.status === 'Submitted');
                            const alreadySubmitted = s.status === 'In Transit' || s.status === 'Delivered';
                            return (
                              <div key={s.id} className="px-4 py-4">
                                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                                  <div>
                                    <p className="text-lg font-semibold text-gray-900">{s.beneficiary_name}</p>
                                    <p className="text-sm text-gray-700 mt-1">Petitioner: {s.petitioner_name}</p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {alreadySubmitted ? (
                                      <span className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg">
                                        <CheckCircle2 className="w-3.5 h-3.5" /> Submitted
                                      </span>
                                    ) : (
                                      <button
                                        onClick={() => submitIndividualPacket(s.id)}
                                        disabled={!canSubmitIndividual || submittingShipmentId === s.id}
                                        className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg ${
                                          canSubmitIndividual
                                            ? 'text-white bg-green-600 hover:bg-green-700'
                                            : 'text-gray-500 bg-gray-200 cursor-not-allowed'
                                        }`}
                                        title={canSubmitIndividual ? 'Submit this packet' : 'Assign tracking before submit'}
                                      >
                                        <Send className="w-3.5 h-3.5" />
                                        {submittingShipmentId === s.id ? 'Submitting...' : 'Submit'}
                                      </button>
                                    )}
                                    <button
                                      onClick={() => setOverrideDraftOpen(prev => ({ ...prev, [s.id]: !prev[s.id] }))}
                                      className="inline-flex items-center justify-center px-3 py-1.5 text-xs font-medium text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-50"
                                    >
                                      {overrideDraftOpen[s.id] ? 'Cancel' : 'Override'}
                                    </button>
                                  </div>
                                </div>
                                <div className="mt-4 pt-4 border-t border-gray-200 space-y-2">
                                  <p className="text-sm text-gray-900">
                                    Status: <span className={`inline-flex px-2.5 py-1 rounded-full text-sm font-medium align-middle ${statusColors[s.status] || 'bg-gray-100 text-gray-700'}`}>{s.status}</span>
                                  </p>
                                  <div className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-sm ${packetTracking ? 'border-green-200 bg-green-50 text-green-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                                    <span className={`inline-block h-2 w-2 rounded-full ${packetTracking ? 'bg-green-600' : 'bg-amber-500'}`} />
                                    {packetTracking ? (
                                      <>
                                        {trackingSource}
                                        <span className="font-mono font-semibold">{packetTracking}</span>
                                      </>
                                    ) : (
                                      <>Tracking Pending</>
                                    )}
                                  </div>
                                </div>
                                {overrideDraftOpen[s.id] && (
                                  <div className="mt-3 grid grid-cols-1 md:grid-cols-[1fr_156px] gap-2">
                                    <input
                                      type="text"
                                      value={individualTrackingDrafts[s.id] || ''}
                                      onChange={e => setIndividualTrackingDrafts(prev => ({ ...prev, [s.id]: e.target.value }))}
                                      placeholder="Enter override tracking number"
                                      className="w-full px-3 py-2 text-sm border rounded-lg outline-none focus:ring-2 focus:ring-blue-500 border-gray-300"
                                    />
                                    <button
                                      onClick={() => saveIndividualTracking(s.id)}
                                      className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800"
                                    >
                                      Save Override
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      <div className="px-4 py-2 bg-gray-50 border-t border-gray-200 text-xs text-gray-500 flex flex-col sm:flex-row sm:justify-between sm:items-end gap-1.5">
                        <span>
                          Last Updated: {group.updated_at ? new Date(group.updated_at).toLocaleString() : (frontDeskLoadedAt ? new Date(frontDeskLoadedAt).toLocaleString() : '-')}
                        </span>
                        <div className="text-right space-y-0.5">
                          <div>Created By: {createdByLabel}</div>
                          <div>Tracking Assigned By: {trackingAssignedByLabel}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
      )}
      <>
          <div className="rounded-2xl border border-slate-200/80 bg-white/90 shadow-[0_16px_34px_-28px_rgba(15,23,42,0.7)] backdrop-blur-sm">
            <div className="p-4 md:p-5 flex flex-col gap-3 xl:flex-row xl:items-center">
              <div className="relative w-full xl:flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={filters.search}
                  onChange={e => setFilters(f => ({ ...f, search: e.target.value, page: 1 }))}
                  placeholder="Search beneficiary, petitioner, or tracking number..."
                  className="w-full pl-10 pr-4 py-2.5 text-sm border border-slate-300 rounded-lg bg-white outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border rounded-lg transition-colors ${showFilters ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'}`}
                >
                  <Filter className="w-4 h-4" /> Filters
                </button>
                {canBulkDelete && selectedShipmentIds.length > 0 && (
                  <>
                    <span className="inline-flex items-center rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700">
                      {selectedShipmentIds.length} selected
                    </span>
                    <button
                      onClick={() => setSelectedShipmentIds([])}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50"
                    >
                      <X className="w-4 h-4" /> Clear Selection
                    </button>
                    <button
                      onClick={() => setShowBulkDeleteConfirm(true)}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg shadow-sm hover:bg-red-700"
                    >
                      <Trash2 className="w-4 h-4" /> Delete Selected
                    </button>
                  </>
                )}
              </div>
            </div>

            {showFilters && (
              <div className="px-4 md:px-5 pb-4 pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Case Type</label>
                  <select value={filters.caseType} onChange={e => setFilters(f => ({ ...f, caseType: e.target.value, page: 1 }))} className="w-full text-sm border border-slate-300 bg-white rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">All</option>
                    {caseTypes.map(ct => <option key={ct.id} value={ct.id}>{ct.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Service Center</label>
                  <select value={filters.serviceCenter} onChange={e => setFilters(f => ({ ...f, serviceCenter: e.target.value, page: 1 }))} className="w-full text-sm border border-slate-300 bg-white rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">All</option>
                    {serviceCenters.map(sc => <option key={sc.id} value={sc.id}>{sc.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Carrier</label>
                  <select value={filters.courierService} onChange={e => setFilters(f => ({ ...f, courierService: e.target.value, page: 1 }))} className="w-full text-sm border border-slate-300 bg-white rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">All</option>
                    {courierServices.map(cs => <option key={cs.id} value={cs.id}>{cs.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Service Type</label>
                  <select value={filters.serviceType} onChange={e => setFilters(f => ({ ...f, serviceType: e.target.value, page: 1 }))} className="w-full text-sm border border-slate-300 bg-white rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">All</option>
                    {serviceTypes.map(st => <option key={st.id} value={st.id}>{st.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Attorney</label>
                  <select value={filters.attorney} onChange={e => setFilters(f => ({ ...f, attorney: e.target.value, page: 1 }))} className="w-full text-sm border border-slate-300 bg-white rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">All</option>
                    {attorneys.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Payment Status</label>
                  <select value={filters.paymentStatus} onChange={e => setFilters(f => ({ ...f, paymentStatus: e.target.value, page: 1 }))} className="w-full text-sm border border-slate-300 bg-white rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">All</option>
                    <option value="Paid">Paid</option>
                    <option value="Not Paid">Not Paid</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Status</label>
                  <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value, page: 1 }))} className="w-full text-sm border border-slate-300 bg-white rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">All</option>
                    <option value="Draft">Draft</option>
                    <option value="Submitted">Submitted</option>
                    <option value="In Transit">In Transit</option>
                    <option value="Delivered">Delivered</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Ship Date</label>
                  <input type="date" value={filters.shipDate} onChange={e => setFilters(f => ({ ...f, shipDate: e.target.value, page: 1 }))} className="w-full text-xs border border-slate-300 bg-white rounded-lg px-2 py-1.5 outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="col-span-full flex justify-end">
                  <button
                    onClick={() => setFilters(f => ({
                      ...f,
                      search: '',
                      caseType: '',
                      serviceCenter: '',
                      courierService: '',
                      serviceType: '',
                      attorney: '',
                      paymentStatus: '',
                      status: '',
                      shipDate: '',
                      dateFrom: '',
                      dateTo: '',
                      page: 1,
                    }))}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                  >
                    <X className="w-3 h-3" /> Clear all filters
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white/90 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.75)] overflow-hidden backdrop-blur-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50/85 border-b border-slate-200">
                    <th className="text-left px-4 py-3 font-medium text-slate-600 w-10">
                      <input
                        type="checkbox"
                        checked={allSelectableOnPageSelected}
                        onChange={(e) => toggleSelectAllOnPage(e.target.checked)}
                        disabled={!deletableShipmentIds.length}
                        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-40"
                        title="Select all deletable shipments on this page"
                      />
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600 cursor-pointer select-none" onClick={() => handleSort('beneficiary_name')}>
                      <div className="flex items-center gap-1">Beneficiary <SortIcon field="beneficiary_name" /></div>
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600 cursor-pointer select-none" onClick={() => handleSort('petitioner_name')}>
                      <div className="flex items-center gap-1">Petitioner <SortIcon field="petitioner_name" /></div>
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600 cursor-pointer select-none" onClick={() => handleSort('tracking_number')}>
                      <div className="flex items-center gap-1">Tracking # <SortIcon field="tracking_number" /></div>
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Case Type</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Service Center</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Carrier</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Service Type</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Payment</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600 cursor-pointer select-none" onClick={() => handleSort('status')}>
                      <div className="flex items-center gap-1">Status <SortIcon field="status" /></div>
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600 cursor-pointer select-none" onClick={() => handleSort('created_at')}>
                      <div className="flex items-center gap-1">Created <SortIcon field="created_at" /></div>
                    </th>
                    <th className="text-right px-4 py-3 font-medium text-slate-600">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {shipments.length === 0 ? (
                    <tr><td colSpan={12} className="text-center py-12 text-slate-500">No shipments found</td></tr>
                  ) : shipments.map(s => (
                    <tr key={s.id} className="transition-colors odd:bg-white even:bg-slate-50/30 hover:bg-blue-50/45">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedShipmentIdSet.has(s.id)}
                          onChange={(e) => toggleShipmentSelection(s.id, e.target.checked)}
                          disabled={!canDeleteShipment(s)}
                          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-40"
                          title={canDeleteShipment(s) ? 'Select shipment' : 'You cannot delete this shipment'}
                        />
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900">{s.beneficiary_name}</td>
                      <td className="px-4 py-3 text-slate-600">{s.petitioner_name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-700">{getTrackingNumber(s)}</td>
                      <td className="px-4 py-3 text-slate-600">{caseTypes.find(c => c.id === s.case_type_id)?.name || '-'}</td>
                      <td className="px-4 py-3 text-slate-600">{serviceCenters.find(c => c.id === s.service_center_id)?.name || '-'}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-700">
                          {courierServices.find(c => c.id === s.courier_service_id)?.name || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{serviceTypes.find(c => c.id === s.service_type_id)?.name || '-'}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${s.payment_status === 'Paid' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {s.payment_status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${statusColors[s.status] || 'bg-gray-100 text-gray-700'}`}>
                          {s.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">{new Date(s.created_at).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => setViewingShipment(s)} className="p-1.5 text-slate-400 hover:text-blue-600 rounded hover:bg-blue-50" title="View">
                            <Eye className="w-4 h-4" />
                          </button>
                          {canEditShipment(s) && (
                            <button onClick={() => { setEditingShipment(s); setShowForm(true); }} className="p-1.5 text-slate-400 hover:text-amber-600 rounded hover:bg-amber-50" title="Edit">
                              <Edit2 className="w-4 h-4" />
                            </button>
                          )}
                          {canDeleteShipment(s) && (
                            <button onClick={() => handleDelete(s.id)} className="p-1.5 text-slate-400 hover:text-red-600 rounded hover:bg-red-50" title="Delete">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between">
                <p className="text-sm text-slate-500">
                  Showing {(filters.page - 1) * filters.pageSize + 1} to {Math.min(filters.page * filters.pageSize, total)} of {total}
                </p>
                <div className="flex items-center gap-1">
                  <button onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))} disabled={filters.page === 1} className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                    const start = Math.max(1, Math.min(filters.page - 2, totalPages - 4));
                    const page = start + i;
                    if (page > totalPages) return null;
                    return (
                      <button key={page} onClick={() => setFilters(f => ({ ...f, page }))} className={`w-8 h-8 rounded text-sm font-medium ${filters.page === page ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                        {page}
                      </button>
                    );
                  })}
                  <button onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))} disabled={filters.page === totalPages} className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed">
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
      </>

      {showForm && (
        <ShipmentFormModal
          shipment={editingShipment}
          orgId={orgId}
          userId={user?.id || ''}
          userName={user?.name || 'Current User'}
          userRole={user?.role || 'Paralegal'}
          serviceCenters={serviceCenters}
          caseTypes={caseTypes}
          serviceTypes={serviceTypes}
          mailDeliveryTypes={mailDeliveryTypes}
          courierServices={courierServices}
          attorneys={attorneys}
          paralegals={paralegals}
          onClose={() => { setShowForm(false); setEditingShipment(null); }}
          onSaved={() => { setShowForm(false); setEditingShipment(null); refresh(); }}
        />
      )}

      {viewingShipment && (
        <ShipmentViewModal
          shipment={viewingShipment}
          serviceCenters={serviceCenters}
          caseTypes={caseTypes}
          serviceTypes={serviceTypes}
          mailDeliveryTypes={mailDeliveryTypes}
          courierServices={courierServices}
          getUserName={getUserName}
          onClose={() => setViewingShipment(null)}
        />
      )}

      <ConfirmModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={confirmDelete}
        title="Delete Shipment"
        message="Are you sure you want to delete this shipment? This action cannot be undone."
        confirmText="Delete"
        variant="danger"
      />

      <ConfirmModal
        isOpen={showBulkDeleteConfirm}
        onClose={() => setShowBulkDeleteConfirm(false)}
        onConfirm={confirmBulkDelete}
        title="Delete Selected Shipments"
        message={`Are you sure you want to delete ${selectedShipmentIds.length} selected shipment${selectedShipmentIds.length === 1 ? '' : 's'}? This action cannot be undone.`}
        confirmText="Delete Selected"
        variant="danger"
      />
    </div>
  );
}
interface FormProps {
  shipment: Shipment | null;
  orgId: string;
  userId: string;
  userName: string;
  userRole: string;
  serviceCenters: import('../types').DropdownItem[];
  caseTypes: import('../types').DropdownItem[];
  serviceTypes: import('../types').DropdownItem[];
  mailDeliveryTypes: import('../types').DropdownItem[];
  courierServices: import('../types').DropdownItem[];
  attorneys: import('../types').User[];
  paralegals: import('../types').User[];
  onClose: () => void;
  onSaved: () => void;
}

function ShipmentFormModal({
  shipment,
  orgId,
  userId,
  userName,
  userRole,
  serviceCenters,
  caseTypes,
  serviceTypes,
  mailDeliveryTypes,
  courierServices,
  attorneys,
  paralegals,
  onClose,
  onSaved,
}: FormProps) {
  const isEdit = !!shipment;
  const isFinanceOnly = userRole === 'Finance';
  const isParalegalUser = userRole === 'Paralegal';
  const isAttorneyUser = userRole === 'Attorney';
  const isFrontDeskUser = userRole === 'FRONT_DESK';
  const canManageTrackingInForm = ['FRONT_DESK', 'OrgAdmin', 'SuperAdmin'].includes(userRole);

  const attorneyOptions = useMemo(() => {
    const base = attorneys.map(a => ({ id: a.id, name: a.name }));
    if (!isAttorneyUser || !userId) return base;
    if (base.some(a => a.id === userId)) return base;
    return [{ id: userId, name: `${userName} (You)` }, ...base];
  }, [attorneys, isAttorneyUser, userId, userName]);

  const paralegalOptions = useMemo(() => {
    const base = paralegals.map(p => ({ id: p.id, name: p.name }));
    if ((!isParalegalUser && !isFrontDeskUser) || !userId) return base;
    if (base.some(p => p.id === userId)) return base;
    return [{ id: userId, name: `${userName} (You)` }, ...base];
  }, [paralegals, isParalegalUser, isFrontDeskUser, userId, userName]);

  const defaultCourierServiceId = useMemo(() => {
    if (shipment?.courier_service_id) return shipment.courier_service_id;
    const fedex = courierServices.find(c => c.name.toLowerCase() === 'fedex');
    if (shipment?.fedex_service_type && fedex) return fedex.id;
    return fedex?.id || courierServices[0]?.id || '';
  }, [courierServices, shipment]);

  const defaultServiceTypeId = useMemo(() => {
    if (shipment?.service_type_id) return shipment.service_type_id;
    const overnight = serviceTypes.find(c => c.name.toLowerCase() === 'overnight');
    return overnight?.id || serviceTypes[0]?.id || '';
  }, [serviceTypes, shipment]);

  const [form, setForm] = useState({
    beneficiary_name: shipment?.beneficiary_name || '',
    petitioner_name: shipment?.petitioner_name || '',
    tracking_number: shipment?.individual_tracking_number || shipment?.tracking_number || '',
    case_type_id: shipment?.case_type_id || '',
    service_center_id: shipment?.service_center_id || '',
    service_type_id: shipment?.service_type_id || '',
    mail_delivery_type_id: shipment?.mail_delivery_type_id || '',
    courier_service_id: shipment?.courier_service_id || '',
    ship_date: shipment?.ship_date || new Date().toISOString().slice(0, 10),
    tva_payment: shipment?.tva_payment ?? false,
    payment_status: (shipment?.payment_status || 'Not Paid') as PaymentStatus,
    attorney_id: shipment?.attorney_id || (isAttorneyUser ? userId : ''),
    paralegal_id: shipment?.paralegal_id || ((isParalegalUser || isFrontDeskUser) ? userId : ''),
    notes: shipment?.notes || '',
    invoice_number: shipment?.invoice_number || '',
    status: (shipment?.status || (isParalegalUser ? 'Submitted' : 'Draft')) as ShipmentStatus,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    if (!form.courier_service_id && defaultCourierServiceId) {
      setForm(f => ({ ...f, courier_service_id: defaultCourierServiceId }));
    }
  }, [defaultCourierServiceId, form.courier_service_id]);

  useEffect(() => {
    if (!form.service_type_id && defaultServiceTypeId) {
      setForm(f => ({ ...f, service_type_id: defaultServiceTypeId }));
    }
  }, [defaultServiceTypeId, form.service_type_id]);

  useEffect(() => {
    if (isEdit) return;
    setForm(prev => {
      let next = prev;
      let changed = false;
      if (!prev.attorney_id && isAttorneyUser && userId) {
        next = { ...next, attorney_id: userId };
        changed = true;
      }
      if (!prev.paralegal_id && (isParalegalUser || isFrontDeskUser) && userId) {
        next = { ...next, paralegal_id: userId };
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [isEdit, isAttorneyUser, isParalegalUser, isFrontDeskUser, userId]);

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!isFinanceOnly) {
      if (!form.beneficiary_name.trim()) errs.beneficiary_name = 'Required';
      if (!form.petitioner_name.trim()) errs.petitioner_name = 'Required';
      if (!form.case_type_id) errs.case_type_id = 'Required';
      if (!form.service_center_id) errs.service_center_id = 'Required';
      if (!form.service_type_id) errs.service_type_id = 'Required';
      if (!form.mail_delivery_type_id) errs.mail_delivery_type_id = 'Required';
      if (!form.courier_service_id) errs.courier_service_id = 'Required';
      if (!form.ship_date) errs.ship_date = 'Required';
      if (!form.attorney_id) errs.attorney_id = 'Required';
      if (!form.paralegal_id) errs.paralegal_id = 'Required';
      if (!form.notes.trim()) errs.notes = 'Required';
      if (!form.invoice_number.trim()) errs.invoice_number = 'Required';
      if (!form.payment_status) errs.payment_status = 'Required';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const saveShipment = async (url: string, method: 'POST' | 'PUT', payload: Record<string, unknown>) => {
    const res = await apiClient.authFetch(url, { method, body: JSON.stringify(payload) });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error || 'Failed to save shipment');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError('');
    if (!validate()) return;
    try {
      if (isEdit && shipment) {
        if (isFinanceOnly) {
          await saveShipment(`/shipments/${shipment.id}`, 'PUT', {
            invoice_number: form.invoice_number,
            payment_status: form.payment_status,
            updated_by: userId,
          });
        } else {
          await saveShipment(`/shipments/${shipment.id}`, 'PUT', {
            ...form,
            tracking_number: canManageTrackingInForm ? form.tracking_number : '',
            status: isParalegalUser ? 'Submitted' : form.status,
            paralegal_id: form.paralegal_id || userId,
            updated_by: userId,
          });
        }
      } else {
        await saveShipment('/shipments', 'POST', {
          ...form,
          tracking_number: canManageTrackingInForm ? form.tracking_number : '',
          status: isParalegalUser ? 'Submitted' : form.status,
          paralegal_id: form.paralegal_id || userId,
          organization_id: orgId,
          created_by: userId,
          updated_by: userId,
        });
      }
      onSaved();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      setSubmitError(message);
    }
  };

  const inputClass = (name: string) =>
    `w-full px-3 py-2 text-sm border rounded-lg outline-none focus:ring-2 focus:ring-blue-500 ${errors[name] ? 'border-red-300 bg-red-50' : 'border-gray-300'}`;

  return (
    <Modal isOpen onClose={onClose} title={isEdit ? (isFinanceOnly ? 'Update Payment Info' : 'Edit Shipment') : 'New Shipment'} size="xl">
      {submitError && (
        <div className="flex items-center gap-2 p-3 mb-4 text-sm text-red-700 bg-red-50 rounded-lg border border-red-200">
          <AlertCircle className="w-4 h-4 flex-shrink-0" /> {submitError}
        </div>
      )}
      <form onSubmit={handleSubmit}>
        {isFinanceOnly ? (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Invoice Number" name="invoice_number" required={false} errors={errors}>
              <input type="text" value={form.invoice_number} onChange={e => setForm(f => ({ ...f, invoice_number: e.target.value }))} className={inputClass('invoice_number')} />
            </Field>
            <Field label="Payment Status" name="payment_status" errors={errors}>
              <select value={form.payment_status} onChange={e => setForm(f => ({ ...f, payment_status: e.target.value as PaymentStatus }))} className={inputClass('payment_status')}>
                <option value="Not Paid">Not Paid</option>
                <option value="Paid">Paid</option>
              </select>
            </Field>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Beneficiary Name" name="beneficiary_name" errors={errors}>
              <input type="text" value={form.beneficiary_name} onChange={e => setForm(f => ({ ...f, beneficiary_name: e.target.value }))} className={inputClass('beneficiary_name')} placeholder="Full legal name" />
            </Field>
            <Field label="Petitioner Name" name="petitioner_name" errors={errors}>
              <input type="text" value={form.petitioner_name} onChange={e => setForm(f => ({ ...f, petitioner_name: e.target.value }))} className={inputClass('petitioner_name')} placeholder="Company or sponsor name" />
            </Field>
            <Field label="Ship Date" name="ship_date" errors={errors}>
              <input type="date" value={form.ship_date} onChange={e => setForm(f => ({ ...f, ship_date: e.target.value }))} className={inputClass('ship_date')} />
            </Field>
            {canManageTrackingInForm ? (
              <Field label="Mail Tracking Number" name="tracking_number" required={false} errors={errors}>
                <input type="text" value={form.tracking_number} onChange={e => setForm(f => ({ ...f, tracking_number: e.target.value }))} className={inputClass('tracking_number')} placeholder="Optional at creation" />
              </Field>
            ) : (
              <div className="flex items-end pb-2 text-xs text-gray-500">Tracking number will be assigned by Front Desk</div>
            )}
            <Field label="Case Type" name="case_type_id" errors={errors}>
              <select value={form.case_type_id} onChange={e => setForm(f => ({ ...f, case_type_id: e.target.value }))} className={inputClass('case_type_id')}>
                <option value="">Select case type</option>
                {caseTypes.map(ct => <option key={ct.id} value={ct.id}>{ct.name}</option>)}
              </select>
            </Field>
            <Field label="USCIS Service Center" name="service_center_id" errors={errors}>
              <select value={form.service_center_id} onChange={e => setForm(f => ({ ...f, service_center_id: e.target.value }))} className={inputClass('service_center_id')}>
                <option value="">Select service center</option>
                {serviceCenters.map(sc => <option key={sc.id} value={sc.id}>{sc.name}</option>)}
              </select>
            </Field>
            <Field label="Carrier" name="courier_service_id" errors={errors}>
              <select value={form.courier_service_id} onChange={e => setForm(f => ({ ...f, courier_service_id: e.target.value }))} className={inputClass('courier_service_id')}>
                <option value="">Select carrier</option>
                {courierServices.map(cs => <option key={cs.id} value={cs.id}>{cs.name}</option>)}
              </select>
            </Field>
            <Field label="Service Type" name="service_type_id" errors={errors}>
              <select value={form.service_type_id} onChange={e => setForm(f => ({ ...f, service_type_id: e.target.value }))} className={inputClass('service_type_id')}>
                <option value="">Select service type</option>
                {serviceTypes.map(st => <option key={st.id} value={st.id}>{st.name}</option>)}
              </select>
            </Field>
            <Field label="Mail Delivery Type" name="mail_delivery_type_id" errors={errors}>
              <select value={form.mail_delivery_type_id} onChange={e => setForm(f => ({ ...f, mail_delivery_type_id: e.target.value }))} className={inputClass('mail_delivery_type_id')}>
                <option value="">Select delivery type</option>
                {mailDeliveryTypes.map(md => <option key={md.id} value={md.id}>{md.name}</option>)}
              </select>
            </Field>
            <Field label="Attorney" name="attorney_id" errors={errors}>
              <select value={form.attorney_id} onChange={e => setForm(f => ({ ...f, attorney_id: e.target.value }))} className={inputClass('attorney_id')}>
                <option value="">Select attorney</option>
                {attorneyOptions.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
            <Field label="Paralegal" name="paralegal_id" errors={errors}>
              <select value={form.paralegal_id} onChange={e => setForm(f => ({ ...f, paralegal_id: e.target.value }))} className={inputClass('paralegal_id')}>
                <option value="">Select paralegal</option>
                {paralegalOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Payment Status" name="payment_status" errors={errors}>
              <select value={form.payment_status} onChange={e => setForm(f => ({ ...f, payment_status: e.target.value as PaymentStatus }))} className={inputClass('payment_status')}>
                <option value="Not Paid">Not Paid</option>
                <option value="Paid">Paid</option>
              </select>
            </Field>
            {!isParalegalUser ? (
              <Field label="Status" name="status" errors={errors}>
                <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as ShipmentStatus }))} className={inputClass('status')}>
                  <option value="Draft">Draft</option>
                  <option value="Submitted">Submitted</option>
                  <option value="In Transit">In Transit</option>
                  <option value="Delivered">Delivered</option>
                </select>
              </Field>
            ) : (
              <div className="flex items-end pb-2 text-xs text-blue-600">This request will be submitted to Front Desk</div>
            )}
            <div className="flex items-center gap-3 pt-6">
              <input type="checkbox" id="tva" checked={form.tva_payment} onChange={e => setForm(f => ({ ...f, tva_payment: e.target.checked }))} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
              <label htmlFor="tva" className="text-sm font-medium text-gray-700">TVA Payment</label>
            </div>
            <Field label="Invoice Number" name="invoice_number" errors={errors}>
              <input type="text" value={form.invoice_number} onChange={e => setForm(f => ({ ...f, invoice_number: e.target.value }))} className={inputClass('invoice_number')} placeholder="INV-XXXX-XXX" />
            </Field>
            <div className="md:col-span-2">
              <Field label="Notes" name="notes" errors={errors}>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} className={inputClass('notes')} placeholder="Additional notes..." />
              </Field>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-200">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
          <button type="submit" className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700">{isEdit ? 'Update' : 'Create'} Shipment</button>
        </div>
      </form>
    </Modal>
  );
}
function ShipmentViewModal({
  shipment,
  serviceCenters,
  caseTypes,
  serviceTypes,
  mailDeliveryTypes,
  courierServices,
  getUserName,
  onClose,
}: {
  shipment: Shipment;
  serviceCenters: import('../types').DropdownItem[];
  caseTypes: import('../types').DropdownItem[];
  serviceTypes: import('../types').DropdownItem[];
  mailDeliveryTypes: import('../types').DropdownItem[];
  courierServices: import('../types').DropdownItem[];
  getUserName: (id?: string) => string;
  onClose: () => void;
}) {
  const Detail = ({ label, value, badge }: { label: string; value: string; badge?: string }) => (
    <div>
      <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider">{label}</dt>
      <dd className="mt-1 text-sm text-gray-900">
        {badge ? <span className={`px-2 py-0.5 rounded text-xs font-medium ${badge}`}>{value}</span> : value || '-'}
      </dd>
    </div>
  );

  const statusColors: Record<string, string> = {
    Draft: 'bg-gray-100 text-gray-700',
    Submitted: 'bg-blue-100 text-blue-700',
    'In Transit': 'bg-amber-100 text-amber-700',
    Delivered: 'bg-green-100 text-green-700',
  };

  const tracking = shipment.effective_tracking_number || shipment.tracking_number || shipment.group_tracking_number || '-';

  return (
    <Modal isOpen onClose={onClose} title="Shipment Details" size="lg">
      <dl className="grid grid-cols-2 gap-4">
        <Detail label="Beneficiary" value={shipment.beneficiary_name} />
        <Detail label="Petitioner" value={shipment.petitioner_name} />
        <Detail label="Tracking Number" value={tracking} />
        <Detail label="Ship Date" value={shipment.ship_date || '-'} />
        <Detail label="Case Type" value={caseTypes.find(c => c.id === shipment.case_type_id)?.name || '-'} />
        <Detail label="Service Center" value={serviceCenters.find(c => c.id === shipment.service_center_id)?.name || '-'} />
        <Detail label="Carrier" value={courierServices.find(c => c.id === shipment.courier_service_id)?.name || '-'} />
        <Detail label="Service Type" value={serviceTypes.find(c => c.id === shipment.service_type_id)?.name || '-'} />
        <Detail label="Mail Delivery Type" value={mailDeliveryTypes.find(c => c.id === shipment.mail_delivery_type_id)?.name || '-'} />
        <Detail label="TVA Payment" value={shipment.tva_payment ? 'Yes' : 'No'} />
        <Detail label="Payment Status" value={shipment.payment_status} badge={shipment.payment_status === 'Paid' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'} />
        <Detail label="Status" value={shipment.status} badge={statusColors[shipment.status]} />
        <Detail label="Attorney" value={getUserName(shipment.attorney_id)} />
        <Detail label="Paralegal" value={getUserName(shipment.paralegal_id)} />
        <Detail label="Invoice Number" value={shipment.invoice_number || '-'} />
        <Detail label="Created" value={new Date(shipment.created_at).toLocaleString()} />
        <div className="col-span-2">
          <Detail label="Notes" value={shipment.notes || 'No notes'} />
        </div>
      </dl>
    </Modal>
  );
}

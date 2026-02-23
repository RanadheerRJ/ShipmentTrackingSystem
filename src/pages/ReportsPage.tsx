import { useEffect, useMemo, useState } from 'react';
import { Download, FileText, Filter } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import apiClient from '../api/client';
import type { DropdownItem, Shipment, User } from '../types';

type DateFilterMode = 'specific' | 'range';

function currentDateISO() {
  return new Date().toISOString().slice(0, 10);
}

function toCsvCell(value: unknown) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

export function ReportsPage() {
  const { user, hasRole } = useAuth();
  const orgId = user?.organization_id || '';
  const isSuperAdmin = hasRole('SuperAdmin');
  const canViewAllUsers = hasRole('SuperAdmin', 'OrgAdmin', 'FRONT_DESK');

  const [dateFilterMode, setDateFilterMode] = useState<DateFilterMode>('specific');
  const [specificDate, setSpecificDate] = useState(() => currentDateISO());
  const [dateFrom, setDateFrom] = useState(() => currentDateISO());
  const [dateTo, setDateTo] = useState(() => currentDateISO());
  const [selectedUserId, setSelectedUserId] = useState<string>(canViewAllUsers ? '' : (user?.id || ''));

  const [rows, setRows] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loadedAt, setLoadedAt] = useState('');

  const [users, setUsers] = useState<User[]>([]);
  const [serviceCenters, setServiceCenters] = useState<DropdownItem[]>([]);
  const [caseTypes, setCaseTypes] = useState<DropdownItem[]>([]);
  const [courierServices, setCourierServices] = useState<DropdownItem[]>([]);
  const [serviceTypes, setServiceTypes] = useState<DropdownItem[]>([]);

  useEffect(() => {
    if (!canViewAllUsers) setSelectedUserId(user?.id || '');
  }, [canViewAllUsers, user?.id]);

  useEffect(() => {
    if (!user) return;
    const loadLookups = async () => {
      try {
        const userPath = isSuperAdmin ? '/users' : `/users?organizationId=${orgId}`;
        const usersResp = await apiClient.authFetch(userPath);
        if (usersResp.ok) {
          const userRows = (await usersResp.json()) as User[];
          setUsers(userRows.filter((u) => u.is_active).sort((a, b) => a.name.localeCompare(b.name)));
        } else {
          setUsers([]);
        }

        if (!orgId) {
          setServiceCenters([]);
          setCaseTypes([]);
          setCourierServices([]);
          setServiceTypes([]);
          return;
        }

        const [scResp, ctResp, csResp, stResp] = await Promise.all([
          apiClient.authFetch(`/dropdowns/service_centers?organizationId=${orgId}`),
          apiClient.authFetch(`/dropdowns/case_types?organizationId=${orgId}`),
          apiClient.authFetch(`/dropdowns/courier_services?organizationId=${orgId}`),
          apiClient.authFetch(`/dropdowns/service_types?organizationId=${orgId}`),
        ]);

        setServiceCenters(scResp.ok ? (await scResp.json()) as DropdownItem[] : []);
        setCaseTypes(ctResp.ok ? (await ctResp.json()) as DropdownItem[] : []);
        setCourierServices(csResp.ok ? (await csResp.json()) as DropdownItem[] : []);
        setServiceTypes(stResp.ok ? (await stResp.json()) as DropdownItem[] : []);
      } catch (err) {
        console.error('Failed loading report lookups', err);
      }
    };

    loadLookups();
  }, [isSuperAdmin, orgId, user]);

  const caseTypeMap = useMemo(() => new Map(caseTypes.map((item) => [item.id, item.name])), [caseTypes]);
  const serviceCenterMap = useMemo(() => new Map(serviceCenters.map((item) => [item.id, item.name])), [serviceCenters]);
  const courierServiceMap = useMemo(() => new Map(courierServices.map((item) => [item.id, item.name])), [courierServices]);
  const serviceTypeMap = useMemo(() => new Map(serviceTypes.map((item) => [item.id, item.name])), [serviceTypes]);
  const userMap = useMemo(() => new Map(users.map((item) => [item.id, item.name])), [users]);
  const isAdmin = hasRole('SuperAdmin', 'OrgAdmin');
  const [outgoingRows, setOutgoingRows] = useState<Shipment[]>([]);

  const getTrackingNumber = (shipment: Shipment) =>
    shipment.effective_tracking_number || shipment.tracking_number || shipment.group_tracking_number || '';

  const getUserName = (id: string | null | undefined) => {
    if (!id) return '-';
    return userMap.get(id) || id.slice(0, 8);
  };

  const generateReport = async () => {
    setError('');
    if (dateFilterMode === 'specific' && !specificDate) {
      setError('Select a date to generate report');
      return;
    }
    if (dateFilterMode === 'range' && dateFrom && dateTo && dateFrom > dateTo) {
      setError('Date from cannot be later than date to');
      return;
    }

    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (orgId) qs.set('organizationId', orgId);

      if (dateFilterMode === 'specific') {
        qs.set('shipDate', specificDate);
      } else {
        if (dateFrom) qs.set('shipDateFrom', dateFrom);
        if (dateTo) qs.set('shipDateTo', dateTo);
      }

      if (canViewAllUsers) {
        if (selectedUserId) qs.set('reportUserId', selectedUserId);
      } else if (user?.id) {
        qs.set('reportUserId', user.id);
      }

      qs.set('page', '1');
      qs.set('pageSize', '50000');
      qs.set('sortBy', 'created_at');
      qs.set('sortDir', 'desc');

      const resp = await apiClient.authFetch(`/shipments?${qs.toString()}`);
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(payload?.error || 'Failed generating report');
      const dataRows = Array.isArray(payload?.data) ? payload.data as Shipment[] : [];
      setRows(dataRows);
      setLoadedAt(new Date().toISOString());
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed generating report';
      setRows([]);
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = () => {
    if (!rows.length) return;
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
      'Ship Date',
      'Created',
    ];

    const csvRows = rows.map((shipment) => [
      shipment.beneficiary_name,
      shipment.petitioner_name,
      getTrackingNumber(shipment),
      caseTypeMap.get(shipment.case_type_id) || shipment.case_type_id,
      serviceCenterMap.get(shipment.service_center_id) || shipment.service_center_id,
      courierServiceMap.get(shipment.courier_service_id) || shipment.courier_service_id,
      serviceTypeMap.get(shipment.service_type_id) || shipment.service_type_id,
      shipment.payment_status,
      shipment.tva_payment ? 'Yes' : 'No',
      shipment.invoice_number || '-',
      getUserName(shipment.attorney_id),
      getUserName(shipment.paralegal_id),
      shipment.status,
      shipment.ship_date || '-',
      new Date(shipment.created_at).toLocaleString(),
    ]);

    const csv = [headers, ...csvRows].map((row) => row.map(toCsvCell).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reports_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const loadedAtLabel = useMemo(() => {
    if (!loadedAt) return '';
    return new Date(loadedAt).toLocaleString();
  }, [loadedAt]);

  const outgoingByParalegal = useMemo(() => {
    const source = (rows && rows.length) ? rows : outgoingRows;
    if (!source || !source.length) return [] as Array<{ paralegalId: string | null; paralegalName: string; attorneyName: string; shipments: Shipment[] }>; 
    const outgoing = source.filter((r) => r.status === 'In Transit');
    const map = new Map<string, { paralegalId: string | null; paralegalName: string; attorneyName: string; shipments: Shipment[] }>();
    for (const s of outgoing) {
      const key = s.paralegal_id || 'unassigned';
      const entry = map.get(key) || { paralegalId: s.paralegal_id || null, paralegalName: getUserName(s.paralegal_id), attorneyName: getUserName(s.attorney_id), shipments: [] as Shipment[] };
      entry.shipments.push(s);
      map.set(key, entry);
    }
    return Array.from(map.values());
  }, [rows, getUserName]);

  const loadOutgoing = async () => {
    if (!isAdmin || !orgId) return;
    try {
      const qs = new URLSearchParams();
      qs.set('organizationId', orgId);
      qs.set('status', 'In Transit');
      qs.set('page', '1');
      qs.set('pageSize', '5000');
      const resp = await apiClient.authFetch(`/shipments?${qs.toString()}`);
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(payload?.error || 'Failed loading outgoing shipments');
      const dataRows = Array.isArray(payload?.data) ? payload.data as Shipment[] : [];
      setOutgoingRows(dataRows);
    } catch (err) {
      console.error('Failed loading outgoing shipments', err);
      setOutgoingRows([]);
    }
  };

  // Auto-load outgoing shipments for admins so cards appear without Generate Report
  useEffect(() => {
    loadOutgoing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, orgId]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
          <p className="text-gray-500 text-sm mt-1">Generate shipment reports by date and user scope</p>
        </div>
        <button
          onClick={exportCsv}
          disabled={!rows.length}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download className="w-4 h-4" /> Export CSV
        </button>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-800 mb-4">
          <Filter className="w-4 h-4" /> Report Filters
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Date Filter Type</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDateFilterMode('specific')}
                className={`px-3 py-2 text-xs rounded-lg border ${dateFilterMode === 'specific' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300'}`}
              >
                Specific Date
              </button>
              <button
                type="button"
                onClick={() => setDateFilterMode('range')}
                className={`px-3 py-2 text-xs rounded-lg border ${dateFilterMode === 'range' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300'}`}
              >
                Date Range
              </button>
            </div>
          </div>

          {dateFilterMode === 'specific' ? (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Ship Date</label>
              <input
                type="date"
                value={specificDate}
                onChange={(e) => setSpecificDate(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Date From</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Date To</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">User Scope</label>
            {canViewAllUsers ? (
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Users</option>
                {users.map((scopeUser) => (
                  <option key={scopeUser.id} value={scopeUser.id}>
                    {scopeUser.name} ({scopeUser.role})
                  </option>
                ))}
              </select>
            ) : (
              <div className="w-full text-sm border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-gray-700">
                {user?.name || 'Current User'}
              </div>
            )}
          </div>
        </div>

        <div className="mt-4">
          <button
            onClick={generateReport}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60"
          >
            <FileText className="w-4 h-4" /> {loading ? 'Generating...' : 'Generate Report'}
          </button>
        </div>

        {error && (
          <div className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </div>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <p className="text-sm font-medium text-gray-800">
            {rows.length} record{rows.length === 1 ? '' : 's'} found
          </p>
          {loadedAtLabel && (
            <p className="text-xs text-gray-500">
              Last generated: {loadedAtLabel}
            </p>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Beneficiary</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Petitioner</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Tracking #</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Payment</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Attorney</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Paralegal</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Ship Date</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((shipment) => (
                <tr key={shipment.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3">{shipment.beneficiary_name}</td>
                  <td className="px-4 py-3">{shipment.petitioner_name}</td>
                  <td className="px-4 py-3">{getTrackingNumber(shipment) || '-'}</td>
                  <td className="px-4 py-3">{shipment.payment_status}</td>
                  <td className="px-4 py-3">{getUserName(shipment.attorney_id)}</td>
                  <td className="px-4 py-3">{getUserName(shipment.paralegal_id)}</td>
                  <td className="px-4 py-3">{shipment.ship_date || '-'}</td>
                  <td className="px-4 py-3">{shipment.status}</td>
                </tr>
              ))}
              {!rows.length && !loading && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-gray-500">
                    Generate a report to view results
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isAdmin && outgoingByParalegal.length > 0 && (
        <div className="mt-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Outgoing Shipments by Paralegal</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {outgoingByParalegal.map((grp) => (
              <div key={grp.paralegalId || 'unassigned'} className="rounded-lg border border-gray-200 p-4 bg-white">
                <p className="text-sm text-gray-600">Attorney: <span className="font-medium text-gray-800">{grp.attorneyName}</span></p>
                <p className="text-sm text-gray-600">Paralegal: <span className="font-medium text-gray-800">{grp.paralegalName}</span></p>
                <div className="mt-2">
                  <p className="text-sm font-semibold text-gray-800">Outgoing Packets ({grp.shipments.length})</p>
                  <p className="text-sm text-gray-600 mt-1">{grp.shipments.map((s) => (getTrackingNumber(s) || s.tracking_number)).filter(Boolean).slice(0, 20).join(', ')}</p>
                </div>
                <div className="mt-3 text-sm text-gray-700">
                  <p className="font-medium">Beneficiaries / Petitioners</p>
                  <ul className="mt-1 list-disc list-inside text-sm text-gray-600 max-h-36 overflow-auto">
                    {grp.shipments.map((s) => (
                      <li key={s.id}>
                        {s.beneficiary_name || '-'} / {s.petitioner_name || '-'} — {serviceCenterMap.get(s.service_center_id) || s.service_center_id || 'Unknown'}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

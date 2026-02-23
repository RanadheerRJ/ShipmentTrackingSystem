import { useState, useEffect } from 'react';
import apiClient from '../api/client';
import { Modal, ConfirmModal } from '../components/ui/Modal';
import { Plus, Building2, Users, Package, ToggleLeft, ToggleRight, Trash2, AlertCircle, ImagePlus, X } from 'lucide-react';
import { fileToImageDataUrl } from '../utils/imageUpload';

export function OrganizationsPage() {
  const [showForm, setShowForm] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [orgs, setOrgs] = useState<any[]>([]);
  const [statsMap, setStatsMap] = useState<Record<string, any>>({});
  const [toggleOrg, setToggleOrg] = useState<{ id: string; name: string; is_active: boolean } | null>(null);
  const [deleteOrg, setDeleteOrg] = useState<{ id: string; name: string } | null>(null);
  const [actionError, setActionError] = useState('');

  const refresh = () => setRefreshKey(k => k + 1);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiClient.authFetch('/organizations');
        const orgsData = await res.json();
        setOrgs(orgsData || []);
        const statsArr = await Promise.all(orgsData.map(async (o: any) => {
          const r = await apiClient.authFetch(`/organizations/${o.id}/stats`);
          const s = await r.json();
          return { id: o.id, stats: s };
        }));
        const map: Record<string, any> = {};
        statsArr.forEach((x: any) => map[x.id] = x.stats);
        setStatsMap(map);
      } catch (err) {
        console.error('Failed to load orgs', err);
      }
    })();
  }, [refreshKey]);

  const handleToggle = async () => {
    if (!toggleOrg) return;
    setActionError('');
    try {
      const res = await apiClient.authFetch(`/organizations/${toggleOrg.id}`, {
        method: 'PUT',
        body: JSON.stringify({ is_active: !toggleOrg.is_active }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to update organization');
      }
      setToggleOrg(null);
      refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update organization';
      setActionError(message);
    }
  };

  const handleDelete = async () => {
    if (!deleteOrg) return;
    setActionError('');
    try {
      const res = await apiClient.authFetch(`/organizations/${deleteOrg.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to delete organization');
      }
      setDeleteOrg(null);
      refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete organization';
      setActionError(message);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Organizations</h1>
          <p className="text-gray-500 text-sm mt-1">Manage tenant organizations</p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700">
          <Plus className="w-4 h-4" /> New Organization
        </button>
      </div>

      {actionError && (
        <div className="flex items-center gap-2 p-3 mb-4 text-sm text-red-700 bg-red-50 rounded-lg border border-red-200">
          <AlertCircle className="w-4 h-4 flex-shrink-0" /> {actionError}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {orgs.map(org => {
          const stats = statsMap[org.id] || { totalShipments: 0, totalUsers: 0 };
          return (
            <div key={org.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center overflow-hidden">
                    {org.logo_data_url ? (
                      <img src={org.logo_data_url} alt={`${org.name} logo`} className="w-full h-full object-cover" />
                    ) : (
                      <Building2 className="w-5 h-5 text-blue-600" />
                    )}
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{org.name}</h3>
                    <p className="text-xs text-gray-500">Since {new Date(org.created_at).toLocaleDateString()}</p>
                    {org.phone_number && <p className="text-xs text-gray-500">{org.phone_number}</p>}
                    {org.location && <p className="text-xs text-gray-500">{org.location}</p>}
                  </div>
                </div>
                <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${org.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {org.is_active ? 'Active' : 'Suspended'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Package className="w-4 h-4 text-gray-400" />
                  <span>{stats.totalShipments} shipments</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Users className="w-4 h-4 text-gray-400" />
                  <span>{stats.totalUsers} users</span>
                </div>
              </div>

              <button onClick={() => setToggleOrg(org)}
                className={`w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium border ${
                  org.is_active ? 'border-red-200 text-red-600 hover:bg-red-50' : 'border-green-200 text-green-600 hover:bg-green-50'
                }`}>
                {org.is_active ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                {org.is_active ? 'Suspend' : 'Activate'}
              </button>

              <button onClick={() => setDeleteOrg({ id: org.id, name: org.name })}
                className="w-full mt-2 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium border border-red-200 text-red-600 hover:bg-red-50">
                <Trash2 className="w-4 h-4" />
                Delete
              </button>
            </div>
          );
        })}
      </div>

      {showForm && (
        <CreateOrgModal onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); refresh(); }} />
      )}

      <ConfirmModal
        isOpen={!!toggleOrg}
        onClose={() => setToggleOrg(null)}
        onConfirm={handleToggle}
        title={toggleOrg?.is_active ? 'Suspend Organization' : 'Activate Organization'}
        message={`Are you sure you want to ${toggleOrg?.is_active ? 'suspend' : 'activate'} "${toggleOrg?.name}"?`}
        confirmText={toggleOrg?.is_active ? 'Suspend' : 'Activate'}
        variant={toggleOrg?.is_active ? 'danger' : 'warning'}
      />

      <ConfirmModal
        isOpen={!!deleteOrg}
        onClose={() => setDeleteOrg(null)}
        onConfirm={handleDelete}
        title="Delete Organization"
        message={`Are you sure you want to delete "${deleteOrg?.name}"? This will permanently remove its users, shipments, and dropdown data.`}
        confirmText="Delete"
        variant="danger"
      />
    </div>
  );
}

function CreateOrgModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: '',
    phone_number: '',
    location: '',
    logo_data_url: '',
    email: '',
    password: '',
  });
  const [error, setError] = useState('');

  const handleLogoChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await fileToImageDataUrl(file, 'Org logo');
      setForm(f => ({ ...f, logo_data_url: dataUrl }));
      setError('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to read org logo';
      setError(message);
    } finally {
      event.target.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.phone_number.trim() || !form.location.trim() || !form.email.trim() || !form.password) {
      setError('All fields are required');
      return;
    }
    if (!/^\d+$/.test(form.phone_number.trim())) {
      setError('Phone number must contain numbers only');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      setError('Invalid email');
      return;
    }
    if (form.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    try {
      const payload = {
        name: form.name.trim(),
        phone_number: form.phone_number.trim(),
        location: form.location.trim(),
        logo_data_url: form.logo_data_url || null,
        email: form.email.trim(),
        password: form.password,
      };
      const res = await apiClient.authFetch('/organizations', { method: 'POST', body: JSON.stringify(payload) });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || 'Failed to create');
        return;
      }
      onSaved();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      setError(message);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Create Organization" size="md">
      {error && (
        <div className="flex items-center gap-2 p-3 mb-4 text-sm text-red-700 bg-red-50 rounded-lg border border-red-200">
          <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Organization Name <span className="text-red-500">*</span></label>
          <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            placeholder="Enter organization name" autoFocus />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number <span className="text-red-500">*</span></label>
          <input type="tel" value={form.phone_number} onChange={e => setForm(f => ({ ...f, phone_number: e.target.value.replace(/\D/g, '') }))}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={15}
            placeholder="Enter organization phone number" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Location <span className="text-red-500">*</span></label>
          <input type="text" value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            placeholder="Enter organization location" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Organization Logo (Optional)</label>
          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50">
              <ImagePlus className="w-4 h-4" />
              {form.logo_data_url ? 'Change Logo' : 'Upload Logo'}
              <input type="file" accept="image/png,image/jpeg,image/jpg,image/webp,image/gif" className="hidden" onChange={handleLogoChange} />
            </label>
            {form.logo_data_url && (
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, logo_data_url: '' }))}
                className="inline-flex items-center gap-1 px-2.5 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                <X className="w-4 h-4" /> Remove
              </button>
            )}
          </div>
          {form.logo_data_url && (
            <img src={form.logo_data_url} alt="Organization logo preview" className="mt-3 w-16 h-16 rounded-lg border border-gray-200 object-cover" />
          )}
          <p className="mt-1 text-xs text-gray-500">PNG, JPG, WEBP, or GIF up to 2MB.</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Org Admin Email <span className="text-red-500">*</span></label>
          <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            placeholder="Enter org admin email" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Org Admin Password <span className="text-red-500">*</span></label>
          <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            placeholder="Set org admin password" />
        </div>
        <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
          <button type="submit" className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700">Create Org + Admin</button>
        </div>
      </form>
    </Modal>
  );
}

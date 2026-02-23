import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import apiClient from '../api/client';
import type { Role, User } from '../types';
import { Modal, ConfirmModal } from '../components/ui/Modal';
import { Plus, UserCheck, UserX, AlertCircle, ImagePlus, X } from 'lucide-react';
import { fileToImageDataUrl, getInitials } from '../utils/imageUpload';

export function UsersPage() {
  const { user, hasRole } = useAuth();
  const isSuperAdmin = hasRole('SuperAdmin');
  const orgId = user?.organization_id || '';

  const [showForm, setShowForm] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [toggleUser, setToggleUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [orgs, setOrgs] = useState<any[]>([]);
  const refresh = () => setRefreshKey(k => k + 1);

  useEffect(() => {
    (async () => {
      try {
        if (isSuperAdmin) {
          const r = await apiClient.authFetch('/users');
          setUsers(await r.json());
          const ro = await apiClient.authFetch('/organizations');
          setOrgs(await ro.json());
        } else {
          const r = await apiClient.authFetch(`/users?organizationId=${orgId}`);
          setUsers(await r.json());
        }
      } catch (err) {
        console.error(err);
      }
    })();
  }, [isSuperAdmin, orgId, refreshKey]);

  const getOrgName = (oid: string | null) => {
    if (!oid) return 'System';
    return orgs.find(o => o.id === oid)?.name || oid.slice(0, 8);
  };

  const roleColors: Record<string, string> = {
    SuperAdmin: 'bg-red-100 text-red-700',
    OrgAdmin: 'bg-blue-100 text-blue-700',
    Paralegal: 'bg-green-100 text-green-700',
    FRONT_DESK: 'bg-cyan-100 text-cyan-700',
    Attorney: 'bg-purple-100 text-purple-700',
    Finance: 'bg-amber-100 text-amber-700',
  };

  const availableRoles: Role[] = isSuperAdmin
    ? ['SuperAdmin', 'OrgAdmin', 'Paralegal', 'FRONT_DESK', 'Attorney', 'Finance']
    : ['Paralegal', 'FRONT_DESK', 'Attorney', 'Finance'];

  const handleRoleChange = (userId: string, newRole: Role) => {
    if (user) {
      (async () => {
        await apiClient.authFetch(`/users/${userId}/role`, { method: 'PUT', body: JSON.stringify({ role: newRole }) });
        refresh();
      })();
    }
  };

  const handleToggleActive = () => {
    if (toggleUser && user) {
      (async () => {
        await apiClient.authFetch(`/users/${toggleUser.id}`, { method: 'PUT', body: JSON.stringify({ is_active: !toggleUser.is_active }) });
        setToggleUser(null);
        refresh();
      })();
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
          <p className="text-gray-500 text-sm mt-1">{users.length} user{users.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700">
          <Plus className="w-4 h-4" /> Add User
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Email</th>
              {isSuperAdmin && <th className="text-left px-4 py-3 font-medium text-gray-600">Organization</th>}
              <th className="text-left px-4 py-3 font-medium text-gray-600">Role</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map(u => (
              <tr key={u.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-semibold overflow-hidden">
                      {u.profile_photo_data_url ? (
                        <img src={u.profile_photo_data_url} alt={`${u.name} profile`} className="w-full h-full object-cover" />
                      ) : (
                        <span>{getInitials(u.name)}</span>
                      )}
                    </div>
                    <span>{u.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-600">{u.email}</td>
                {isSuperAdmin && <td className="px-4 py-3 text-gray-600">{getOrgName(u.organization_id)}</td>}
                <td className="px-4 py-3">
                  {u.id === user?.id ? (
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${roleColors[u.role]}`}>{u.role}</span>
                  ) : (
                    <select value={u.role} onChange={e => handleRoleChange(u.id, e.target.value as Role)}
                      className="text-xs font-medium border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-2 focus:ring-blue-500">
                      {availableRoles.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${u.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {u.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  {u.id !== user?.id && (
                    <button onClick={() => setToggleUser(u)}
                      className={`p-1.5 rounded hover:bg-gray-100 ${u.is_active ? 'text-red-500 hover:text-red-700' : 'text-green-500 hover:text-green-700'}`}
                      title={u.is_active ? 'Deactivate' : 'Activate'}>
                      {u.is_active ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <CreateUserModal
          orgId={orgId}
          isSuperAdmin={isSuperAdmin}
          organizations={orgs}
          availableRoles={availableRoles}
          userId={user?.id || ''}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); refresh(); }}
        />
      )}

      <ConfirmModal
        isOpen={!!toggleUser}
        onClose={() => setToggleUser(null)}
        onConfirm={handleToggleActive}
        title={toggleUser?.is_active ? 'Deactivate User' : 'Activate User'}
        message={`Are you sure you want to ${toggleUser?.is_active ? 'deactivate' : 'activate'} ${toggleUser?.name}?`}
        confirmText={toggleUser?.is_active ? 'Deactivate' : 'Activate'}
        variant={toggleUser?.is_active ? 'danger' : 'warning'}
      />
    </div>
  );
}

function CreateUserModal({ orgId, isSuperAdmin, organizations, availableRoles, userId, onClose, onSaved }: {
  orgId: string;
  isSuperAdmin: boolean;
  organizations: import('../types').Organization[];
  availableRoles: Role[];
  userId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: '', email: '', password: '', role: 'Paralegal' as Role,
    organization_id: isSuperAdmin ? '' : orgId,
    profile_photo_data_url: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState('');

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = 'Required';
    if (!form.email.trim()) errs.email = 'Required';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = 'Invalid email';
    if (!form.password || form.password.length < 6) errs.password = 'Min 6 characters';
    if (form.role !== 'SuperAdmin' && !form.organization_id) errs.organization_id = 'Required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError('');
    if (!validate()) return;
    try {
      (async () => {
        const payload = {
          email: form.email,
          name: form.name,
          password: form.password,
          role: form.role,
          organization_id: form.role === 'SuperAdmin' ? null : form.organization_id,
          profile_photo_data_url: form.profile_photo_data_url || null,
        };
        const res = await apiClient.authFetch('/users', { method: 'POST', body: JSON.stringify(payload) });
        if (!res.ok) {
          const d = await res.json();
          setSubmitError(d.error || 'Failed to create user');
        } else {
          onSaved();
        }
      })();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      setSubmitError(message);
    }
  };

  const handleProfilePhotoChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const dataUrl = await fileToImageDataUrl(file, 'Profile photo');
      setForm(f => ({ ...f, profile_photo_data_url: dataUrl }));
      setSubmitError('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to read profile photo';
      setSubmitError(message);
    } finally {
      event.target.value = '';
    }
  };

  const inputClass = (name: string) =>
    `w-full px-3 py-2 text-sm border rounded-lg outline-none focus:ring-2 focus:ring-blue-500 ${errors[name] ? 'border-red-300 bg-red-50' : 'border-gray-300'}`;

  return (
    <Modal isOpen onClose={onClose} title="Add New User" size="md">
      {submitError && (
        <div className="flex items-center gap-2 p-3 mb-4 text-sm text-red-700 bg-red-50 rounded-lg border border-red-200">
          <AlertCircle className="w-4 h-4 flex-shrink-0" /> {submitError}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Full Name <span className="text-red-500">*</span></label>
          <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inputClass('name')} />
          {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email <span className="text-red-500">*</span></label>
          <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className={inputClass('email')} />
          {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Password <span className="text-red-500">*</span></label>
          <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} className={inputClass('password')} />
          {errors.password && <p className="text-xs text-red-500 mt-1">{errors.password}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Profile Photo (Optional)</label>
          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50">
              <ImagePlus className="w-4 h-4" />
              {form.profile_photo_data_url ? 'Change Photo' : 'Upload Photo'}
              <input type="file" accept="image/png,image/jpeg,image/jpg,image/webp,image/gif" className="hidden" onChange={handleProfilePhotoChange} />
            </label>
            {form.profile_photo_data_url && (
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, profile_photo_data_url: '' }))}
                className="inline-flex items-center gap-1 px-2.5 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                <X className="w-4 h-4" /> Remove
              </button>
            )}
          </div>
          {form.profile_photo_data_url && (
            <img src={form.profile_photo_data_url} alt="Profile photo preview" className="mt-3 w-14 h-14 rounded-full border border-gray-200 object-cover" />
          )}
          <p className="mt-1 text-xs text-gray-500">PNG, JPG, WEBP, or GIF up to 2MB.</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Role <span className="text-red-500">*</span></label>
          <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value as Role }))} className={inputClass('role')}>
            {availableRoles.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        {isSuperAdmin && form.role !== 'SuperAdmin' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Organization <span className="text-red-500">*</span></label>
            <select value={form.organization_id} onChange={e => setForm(f => ({ ...f, organization_id: e.target.value }))} className={inputClass('organization_id')}>
              <option value="">Select organization</option>
              {organizations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            {errors.organization_id && <p className="text-xs text-red-500 mt-1">{errors.organization_id}</p>}
          </div>
        )}
        <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
          <button type="submit" className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700">Create User</button>
        </div>
      </form>
    </Modal>
  );
}

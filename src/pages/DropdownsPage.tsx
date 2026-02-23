import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import apiClient from '../api/client';
import type { DropdownItem } from '../types';
import { ConfirmModal } from '../components/ui/Modal';
import { Plus, Trash2, Building, FileText, Truck, Package, Clock3 } from 'lucide-react';

type DropdownType = 'service_centers' | 'case_types' | 'mail_delivery_types' | 'courier_services' | 'service_types';

const tabs: { key: DropdownType; label: string; icon: React.ReactNode }[] = [
  { key: 'service_centers', label: 'USCIS Service Centers', icon: <Building className="w-4 h-4" /> },
  { key: 'case_types', label: 'Case Types', icon: <FileText className="w-4 h-4" /> },
  { key: 'mail_delivery_types', label: 'Mail Delivery Types', icon: <Truck className="w-4 h-4" /> },
  { key: 'courier_services', label: 'Courier Services', icon: <Package className="w-4 h-4" /> },
  { key: 'service_types', label: 'Service Types', icon: <Clock3 className="w-4 h-4" /> },
];

export function DropdownsPage() {
  const { user } = useAuth();
  const orgIdFromUser = user?.organization_id || '';

  const [organizations, setOrganizations] = useState<any[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>(orgIdFromUser || '');

  const [activeTab, setActiveTab] = useState<DropdownType>('service_centers');
  const [newName, setNewName] = useState('');
  const [deleteItem, setDeleteItem] = useState<DropdownItem | null>(null);
  const [items, setItems] = useState<DropdownItem[]>([]);

  const refresh = () => {
    (async () => {
      try {
        const effectiveOrg = user?.role === 'SuperAdmin' ? selectedOrgId : orgIdFromUser;
        const q = effectiveOrg ? `?organizationId=${effectiveOrg}` : '';
        const res = await apiClient.authFetch(`/dropdowns/${activeTab}${q}`);
        const data = await res.json();
        setItems(data || []);
      } catch (err) {
        console.error(err);
      }
    })();
  };

  useEffect(() => { refresh(); }, [activeTab, orgIdFromUser, selectedOrgId]);

  // Load organizations for SuperAdmin so they can pick one
  useEffect(() => {
    (async () => {
      try {
        if (user?.role === 'SuperAdmin') {
          const r = await apiClient.authFetch('/organizations');
          const list = await r.json();
          setOrganizations(list);
          // if no selectedOrgId, preselect the first org
          if (!selectedOrgId && list && list.length) {
            setSelectedOrgId(list[0].id);
          }
        }
      } catch (err) {
        console.error('Failed loading organizations', err);
      }
    })();
  }, [user?.role]);

  const handleAdd = async () => {
    if (!newName.trim() || !user) { console.log('Add aborted: empty name or no user', { newName, user }); return; }
    const effectiveOrg = user?.role === 'SuperAdmin' ? selectedOrgId : orgIdFromUser;
    if (!effectiveOrg) { alert('Please select an organization before adding items.'); return; }
    console.log('Adding dropdown item', { type: activeTab, name: newName.trim(), orgId: effectiveOrg });
    try {
      const body: any = { name: newName.trim(), organization_id: effectiveOrg };
      const res = await apiClient.authFetch(`/dropdowns/${activeTab}`, { method: 'POST', body: JSON.stringify(body) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('Failed adding dropdown item', err);
        alert(`Failed to add: ${err?.error || JSON.stringify(err)}`);
        return;
      }
      setNewName('');
      refresh();
    } catch (err) {
      console.error('Failed adding dropdown item', err);
      // surface a visible error so users know something happened
      // eslint-disable-next-line no-alert
      alert('Failed to add dropdown item - see console for details.');
    }
  };

  const handleDelete = async () => {
    if (deleteItem && user) {
      const res = await apiClient.authFetch(`/dropdowns/${activeTab}/${deleteItem.id}`, { method: 'DELETE' });
      if (res.ok) {
        setDeleteItem(null);
        refresh();
      }
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Dropdown Management</h1>
        <p className="text-gray-500 text-sm mt-1">Manage organization-specific dropdown values</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1 w-fit">
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => { setActiveTab(tab.key); setNewName(''); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.key ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}>
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        {/* Add new item */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex gap-3">
            <input type="text" value={newName} onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              placeholder={`Add new ${tabs.find(t => t.key === activeTab)?.label.toLowerCase().replace(/s$/, '')}...`}
              className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
            <button onClick={handleAdd} disabled={!newName.trim()}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
              <Plus className="w-4 h-4" /> Add
            </button>
          </div>
        </div>

        {/* Items list */}
        <div className="divide-y divide-gray-100">
          {items.length === 0 ? (
            <div className="py-12 text-center text-gray-500">No items configured yet</div>
          ) : items.map(item => (
            <div key={item.id} className="px-4 py-3 flex items-center justify-between hover:bg-gray-50">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-sm font-medium text-gray-900">{item.name}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400">{new Date(item.created_at).toLocaleDateString()}</span>
                <button onClick={() => setDeleteItem(item)}
                  className="p-1.5 text-gray-400 hover:text-red-600 rounded hover:bg-red-50">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="px-4 py-3 border-t border-gray-200 text-xs text-gray-500">
          {items.length} active item{items.length !== 1 ? 's' : ''}
        </div>
      </div>

      <ConfirmModal
        isOpen={!!deleteItem}
        onClose={() => setDeleteItem(null)}
        onConfirm={handleDelete}
        title="Remove Item"
        message={`Are you sure you want to remove "${deleteItem?.name}"? This will deactivate it from future use.`}
        confirmText="Remove"
        variant="danger"
      />
    </div>
  );
}

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import apiClient from '../api/client';
import type { AuditActionType } from '../types';
import { FileText, Search, ChevronDown, ChevronUp } from 'lucide-react';

export function AuditPage() {
  const { user, hasRole } = useAuth();
  const isSuperAdmin = hasRole('SuperAdmin');
  const orgId = isSuperAdmin ? null : user?.organization_id || null;

  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [allLogs, setAllLogs] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const res = await apiClient.authFetch(`/audit${orgId ? `?organizationId=${orgId}` : ''}`);
        const data = await res.json();
        setAllLogs(data || []);
      } catch (err) {
        console.error(err);
      }
    })();
  }, [orgId]);

  const filteredLogs = useMemo(() => {
    let logs = allLogs;
    if (search) {
      const q = search.toLowerCase();
      logs = logs.filter(l =>
        l.performed_by_name.toLowerCase().includes(q) ||
        l.entity_type.toLowerCase().includes(q) ||
        l.entity_id.toLowerCase().includes(q)
      );
    }
    if (actionFilter) logs = logs.filter(l => l.action_type === actionFilter);
    if (entityFilter) logs = logs.filter(l => l.entity_type === entityFilter);
    return logs;
  }, [allLogs, search, actionFilter, entityFilter]);

  const actionColors: Record<AuditActionType, string> = {
    CREATE: 'bg-green-100 text-green-700',
    UPDATE: 'bg-blue-100 text-blue-700',
    DELETE: 'bg-red-100 text-red-700',
    LOGIN: 'bg-purple-100 text-purple-700',
    ROLE_CHANGE: 'bg-amber-100 text-amber-700',
    ORG_CHANGE: 'bg-cyan-100 text-cyan-700',
  };

  const entityTypes = [...new Set(allLogs.map(l => l.entity_type))];
  const actionTypes: AuditActionType[] = ['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'ROLE_CHANGE', 'ORG_CHANGE'];

  const formatJson = (json: string | null) => {
    if (!json) return 'null';
    try {
      return JSON.stringify(JSON.parse(json), null, 2);
    } catch {
      return json;
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Audit Logs</h1>
        <p className="text-gray-500 text-sm mt-1">{filteredLogs.length} event{filteredLogs.length !== 1 ? 's' : ''} recorded</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex-1 relative min-w-[250px]">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by user, entity type, or ID..."
              className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <select value={actionFilter} onChange={e => setActionFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All Actions</option>
            {actionTypes.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={entityFilter} onChange={e => setEntityFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All Entities</option>
            {entityTypes.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
      </div>

      {/* Logs */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="divide-y divide-gray-100">
          {filteredLogs.length === 0 ? (
            <div className="py-12 text-center text-gray-500">No audit logs found</div>
          ) : filteredLogs.slice(0, 100).map(log => (
            <div key={log.id} className="hover:bg-gray-50 transition-colors">
              <button onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                className="w-full px-4 py-3 flex items-center justify-between text-left">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <FileText className="w-4 h-4 text-gray-500" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${actionColors[log.action_type]}`}>
                        {log.action_type}
                      </span>
                      <span className="text-sm font-medium text-gray-900">{log.entity_type}</span>
                      <span className="text-xs text-gray-400 font-mono truncate max-w-[120px]">{log.entity_id.slice(0, 8)}...</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500">
                      <span>by {log.performed_by_name}</span>
                      <span>•</span>
                      <span>{new Date(log.timestamp).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
                {expandedId === log.id ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
              </button>

              {expandedId === log.id && (
                <div className="px-4 pb-4 pl-15">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 ml-11">
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase mb-1">Old Value</p>
                      <pre className="text-xs bg-red-50 border border-red-100 rounded-lg p-3 overflow-auto max-h-48 text-red-800 whitespace-pre-wrap">
                        {formatJson(log.old_value)}
                      </pre>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase mb-1">New Value</p>
                      <pre className="text-xs bg-green-50 border border-green-100 rounded-lg p-3 overflow-auto max-h-48 text-green-800 whitespace-pre-wrap">
                        {formatJson(log.new_value)}
                      </pre>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

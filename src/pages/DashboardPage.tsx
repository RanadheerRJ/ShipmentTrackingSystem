import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import apiClient from '../api/client';
import { Package, Users, Building2, FileText, Clock, CheckCircle, AlertCircle } from 'lucide-react';
import { TimeStationQuickCard } from '../components/time/TimeStationQuickCard';

export function DashboardPage() {
  const { user, hasRole } = useAuth();
  const isSuperAdmin = hasRole('SuperAdmin');

  const [stats, setStats] = useState<any>(null);
  const [orgs, setOrgs] = useState<any[]>([]);
  const [orgStats, setOrgStats] = useState<Record<string, any>>({});
  useEffect(() => {
    (async () => {
      try {
        if (isSuperAdmin) {
          const r = await apiClient.authFetch('/organizations/stats/global');
          const gs = await r.json();
          setStats(gs);
          const ro = await apiClient.authFetch('/organizations');
          const orgsList = await ro.json();
          setOrgs(orgsList);
          const statsMap: Record<string, any> = {};
          await Promise.all(orgsList.map(async (o: any) => {
            try {
              const sr = await apiClient.authFetch(`/organizations/${o.id}/stats`);
              statsMap[o.id] = await sr.json();
            } catch (e) {
              statsMap[o.id] = { totalShipments: 0, totalUsers: 0, draftShipments: 0, submittedShipments: 0, inTransitShipments: 0, deliveredShipments: 0, paidShipments: 0, unpaidShipments: 0 };
            }
          }));
          setOrgStats(statsMap);
        } else if (user?.organization_id) {
          const r = await apiClient.authFetch(`/organizations/${user.organization_id}/stats`);
          setStats(await r.json());
        }
      } catch (err) {
        console.error(err);
      }
    })();
  }, [isSuperAdmin, user?.organization_id]);

  if (!stats) return null;

  if (isSuperAdmin) {
    const gs = stats as any;
    return (
      <div>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Super Admin Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">System-wide overview and management</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard icon={<Building2 className="w-5 h-5" />} label="Organizations" value={gs.totalOrgs} sublabel={`${gs.activeOrgs} active`} color="blue" />
          <StatCard icon={<Package className="w-5 h-5" />} label="Total Shipments" value={gs.totalShipments} color="green" />
          <StatCard icon={<Users className="w-5 h-5" />} label="Total Users" value={gs.totalUsers} color="purple" />
          <StatCard icon={<FileText className="w-5 h-5" />} label="Audit Events" value={gs.recentAuditCount} color="amber" />
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Organizations</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {orgs.map(org => {
              const os = orgStats[org.id] || { totalShipments: 0, totalUsers: 0, draftShipments: 0, submittedShipments: 0, inTransitShipments: 0, deliveredShipments: 0, paidShipments: 0, unpaidShipments: 0 };
              return (
                <div key={org.id} className="px-6 py-4 flex items-center justify-between hover:bg-gray-50">
                  <div>
                    <h3 className="font-medium text-gray-900">{org.name}</h3>
                    <p className="text-xs text-gray-500 mt-0.5">Created: {new Date(org.created_at).toLocaleDateString()}</p>
                  </div>
                  <div className="flex items-center gap-6 text-sm">
                    <div className="text-center">
                      <div className="font-semibold text-gray-900">{os.totalShipments}</div>
                      <div className="text-xs text-gray-500">Shipments</div>
                    </div>
                    <div className="text-center">
                      <div className="font-semibold text-gray-900">{os.totalUsers}</div>
                      <div className="text-xs text-gray-500">Users</div>
                    </div>
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${org.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {org.is_active ? 'Active' : 'Suspended'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  const os = stats as any;
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">Welcome back, {user?.name}</p>
        </div>
      </div>

      {user?.organization_id && (
        <div className="mb-6">
          <TimeStationQuickCard compactWhenActive />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard icon={<Package className="w-5 h-5" />} label="Total Shipments" value={os.totalShipments} color="blue" />
        <StatCard icon={<Clock className="w-5 h-5" />} label="In Transit" value={os.inTransitShipments} sublabel={`${os.submittedShipments} submitted`} color="amber" />
        <StatCard icon={<CheckCircle className="w-5 h-5" />} label="Delivered" value={os.deliveredShipments} color="green" />
        <StatCard icon={<AlertCircle className="w-5 h-5" />} label="Unpaid" value={os.unpaidShipments} sublabel={`of ${os.totalShipments} total`} color="red" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Shipment Status Breakdown</h2>
          <div className="space-y-3">
            <StatusBar label="Draft" value={os.draftShipments} total={os.totalShipments} color="bg-gray-400" />
            <StatusBar label="Submitted" value={os.submittedShipments} total={os.totalShipments} color="bg-blue-500" />
            <StatusBar label="In Transit" value={os.inTransitShipments} total={os.totalShipments} color="bg-amber-500" />
            <StatusBar label="Delivered" value={os.deliveredShipments} total={os.totalShipments} color="bg-green-500" />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Payment Overview</h2>
          <div className="flex items-center justify-center gap-12 py-8">
            <div className="text-center">
              <div className="text-4xl font-bold text-green-600">{os.paidShipments}</div>
              <div className="text-sm text-gray-500 mt-1">Paid</div>
            </div>
            <div className="w-px h-16 bg-gray-200" />
            <div className="text-center">
              <div className="text-4xl font-bold text-red-500">{os.unpaidShipments}</div>
              <div className="text-sm text-gray-500 mt-1">Not Paid</div>
            </div>
          </div>
          {os.totalShipments > 0 && (
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div className="bg-green-500 h-3 rounded-full transition-all" style={{ width: `${(os.paidShipments / os.totalShipments) * 100}%` }} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, sublabel, color }: { icon: React.ReactNode; label: string; value: number; sublabel?: string; color: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    purple: 'bg-purple-50 text-purple-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
  };
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${colors[color]}`}>{icon}</div>
        <span className="text-sm font-medium text-gray-600">{label}</span>
      </div>
      <div className="text-3xl font-bold text-gray-900">{value}</div>
      {sublabel && <p className="text-xs text-gray-500 mt-1">{sublabel}</p>}
    </div>
  );
}

function StatusBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-600">{label}</span>
        <span className="font-medium text-gray-900">{value}</span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-2">
        <div className={`${color} h-2 rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

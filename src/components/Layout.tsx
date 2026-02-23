import { type ReactNode, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  Package, Users, Settings, FileText, Shield, Building2, LogOut,
  BarChart3, ChevronLeft, ChevronRight, FileSearch, UserCircle2, Clock3
} from 'lucide-react';
import { getInitials } from '../utils/imageUpload';

interface NavItem {
  id: string;
  label: string;
  icon: ReactNode;
  section: 'Operations' | 'Workspace' | 'Administration';
  roles?: string[];
}

interface LayoutProps {
  children: ReactNode;
  activePage: string;
  onNavigate: (page: string) => void;
}

export function Layout({ children, activePage, onNavigate }: LayoutProps) {
  const { user, logout, hasRole } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  const navItems: NavItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: <BarChart3 className="w-5 h-5" />, section: 'Operations' },
    { id: 'time-station', label: 'Time Station', icon: <Clock3 className="w-5 h-5" />, section: 'Operations' },
    { id: 'shipments', label: 'Shipments', icon: <Package className="w-5 h-5" />, section: 'Operations' },
    { id: 'reports', label: 'Reports', icon: <FileSearch className="w-5 h-5" />, section: 'Operations' },
    { id: 'profile', label: 'Profile', icon: <UserCircle2 className="w-5 h-5" />, section: 'Workspace' },
    { id: 'users', label: 'User Management', icon: <Users className="w-5 h-5" />, section: 'Administration', roles: ['SuperAdmin', 'OrgAdmin'] },
    { id: 'dropdowns', label: 'Dropdown Management', icon: <Settings className="w-5 h-5" />, section: 'Administration', roles: ['SuperAdmin', 'OrgAdmin'] },
    { id: 'organizations', label: 'Organizations', icon: <Building2 className="w-5 h-5" />, section: 'Administration', roles: ['SuperAdmin'] },
    { id: 'audit', label: 'Audit Logs', icon: <FileText className="w-5 h-5" />, section: 'Administration', roles: ['SuperAdmin', 'OrgAdmin'] },
  ];

  const filteredNav = navItems.filter(item => {
    if (!item.roles) return true;
    return item.roles.some(r => hasRole(r as import('../types').Role));
  });

  const navSections = useMemo(() => {
    const orderedSections: Array<NavItem['section']> = ['Operations', 'Workspace', 'Administration'];
    return orderedSections
      .map((section) => ({
        section,
        items: filteredNav.filter(item => item.section === section),
      }))
      .filter(section => section.items.length > 0);
  }, [filteredNav]);

  const roleColors: Record<string, string> = {
    SuperAdmin: 'bg-rose-100 text-rose-700',
    OrgAdmin: 'bg-sky-100 text-sky-700',
    Paralegal: 'bg-emerald-100 text-emerald-700',
    FRONT_DESK: 'bg-cyan-100 text-cyan-700',
    Attorney: 'bg-violet-100 text-violet-700',
    Finance: 'bg-amber-100 text-amber-700',
  };

  return (
    <div className="flex h-screen bg-[#dfe8f7]">
      {/* Sidebar */}
      <aside className={`${collapsed ? 'w-[74px]' : 'w-72'} bg-gradient-to-b from-[#0a1738] via-[#0c1f4a] to-[#0a1634] text-white flex flex-col transition-all duration-300 flex-shrink-0 border-r border-slate-700/70 shadow-[0_24px_50px_-32px_rgba(2,6,23,0.95)]`}>
        <div className={`flex items-center gap-3 px-4 py-5 border-b border-white/10 ${collapsed ? 'justify-center' : ''}`}>
          <div className="w-9 h-9 bg-gradient-to-br from-blue-400 to-blue-600 rounded-xl flex items-center justify-center flex-shrink-0 shadow-[0_10px_22px_-14px_rgba(96,165,250,1)]">
            <Shield className="w-5 h-5 text-white" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <h1 className="text-[1.05rem] font-semibold leading-none truncate">USCIS Tracker</h1>
              <p className="text-[11px] text-slate-300/80 mt-1 truncate">Shipment Management</p>
            </div>
          )}
        </div>

        <nav className="flex-1 py-4 px-2.5 overflow-y-auto">
          {navSections.map((section, sectionIndex) => (
            <div
              key={section.section}
              className={sectionIndex === 0 ? '' : 'mt-4 pt-4 border-t border-white/10'}
            >
              {!collapsed && (
                <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-slate-300/70">
                  {section.section}
                </p>
              )}
              <div className="space-y-1.5">
                {section.items.map(item => (
                  <button
                    key={item.id}
                    onClick={() => onNavigate(item.id)}
                    className={`group w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium border transition-all duration-200 ${
                      activePage === item.id
                        ? 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white border-blue-300/40 shadow-[0_12px_26px_-14px_rgba(59,130,246,0.95)]'
                        : 'text-slate-200/90 border-transparent hover:bg-white/10 hover:border-white/10 hover:text-white'
                    } ${collapsed ? 'justify-center' : ''}`}
                    title={collapsed ? item.label : undefined}
                  >
                    <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                      activePage === item.id
                        ? 'bg-white/15'
                        : 'bg-white/[0.07] group-hover:bg-white/[0.14]'
                    }`}>
                      {item.icon}
                    </span>
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-white/10 px-2.5 py-3">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={`w-full inline-flex items-center rounded-xl border border-white/15 bg-white/[0.06] px-3 py-2 text-slate-200 transition-all duration-200 hover:bg-white/[0.12] hover:text-white ${
              collapsed ? 'justify-center' : 'justify-between'
            }`}
            title={collapsed ? 'Expand menu' : 'Collapse menu'}
          >
            {!collapsed && <span className="text-xs font-semibold tracking-[0.08em] uppercase">Collapse Menu</span>}
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-white/[0.12]">
              {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </span>
          </button>
        </div>

        {/* User info */}
        <div className={`border-t border-white/10 p-3 ${collapsed ? 'flex justify-center' : ''}`}>
          {!collapsed ? (
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1 flex items-center gap-2">
                <div className="w-9 h-9 rounded-full bg-sky-100 text-sky-900 flex items-center justify-center text-xs font-semibold overflow-hidden flex-shrink-0 ring-2 ring-white/20">
                  {user?.profile_photo_data_url ? (
                    <img src={user.profile_photo_data_url} alt={`${user.name} profile`} className="w-full h-full object-cover" />
                  ) : (
                    <span>{getInitials(user?.name, 'U')}</span>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate text-white">{user?.name}</p>
                  <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full mt-1 ${roleColors[user?.role || ''] || 'bg-gray-100 text-gray-700'}`}>
                    {user?.role}
                  </span>
                </div>
              </div>
              <button onClick={logout} className="p-2 text-slate-300 hover:text-red-300 rounded-lg border border-transparent hover:border-red-300/25 hover:bg-red-500/10" title="Logout">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button onClick={logout} className="p-2 text-slate-300 hover:text-red-300 rounded-lg border border-transparent hover:border-red-300/25 hover:bg-red-500/10" title="Logout">
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto bg-[radial-gradient(150%_110%_at_100%_0%,#ced9ff_0%,#e3ebff_40%,#ecf2ff_70%,#f6f9ff_100%)]">
        <div className="p-6 md:p-7 max-w-[1600px] mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}

import { useState, Component, type ReactNode, type ErrorInfo } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { ShipmentsPage } from './pages/ShipmentsPage';
import { UsersPage } from './pages/UsersPage';
import { DropdownsPage } from './pages/DropdownsPage';
import { OrganizationsPage } from './pages/OrganizationsPage';
import { AuditPage } from './pages/AuditPage';
import { ReportsPage } from './pages/ReportsPage';
import { ProfilePage } from './pages/ProfilePage';
import { TimeStationPage } from './pages/TimeStationPage';

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('App Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-lg p-8 max-w-md text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Something went wrong</h2>
            <p className="text-gray-600 text-sm mb-4">{this.state.error?.message || 'An unexpected error occurred'}</p>
            <button
              onClick={() => {
                localStorage.removeItem('uscis_tracking_db');
                localStorage.removeItem('uscis_auth_user');
                window.location.reload();
              }}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              Reset & Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppContent() {
  const { isAuthenticated, hasRole } = useAuth();
  const [activePage, setActivePage] = useState('dashboard');

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  const renderPage = () => {
    switch (activePage) {
      case 'dashboard':
        return <DashboardPage />;
      case 'shipments':
        return <ShipmentsPage />;
      case 'reports':
        return <ReportsPage />;
      case 'profile':
        return <ProfilePage />;
      case 'time-station':
        return <TimeStationPage />;
      case 'users':
        if (hasRole('SuperAdmin', 'OrgAdmin')) return <UsersPage />;
        return <DashboardPage />;
      case 'dropdowns':
        if (hasRole('SuperAdmin', 'OrgAdmin')) return <DropdownsPage />;
        return <DashboardPage />;
      case 'organizations':
        if (hasRole('SuperAdmin')) return <OrganizationsPage />;
        return <DashboardPage />;
      case 'audit':
        if (hasRole('SuperAdmin', 'OrgAdmin')) return <AuditPage />;
        return <DashboardPage />;
      default:
        return <DashboardPage />;
    }
  };

  return (
    <Layout activePage={activePage} onNavigate={setActivePage}>
      {renderPage()}
    </Layout>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ErrorBoundary>
  );
}

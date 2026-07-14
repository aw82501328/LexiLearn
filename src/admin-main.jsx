import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { AppProvider } from './context/AppContext';
import ProtectedRoute from './components/ProtectedRoute';
import AdminLayout from './pages/AdminLayout';
import AdminUsersPage from './pages/AdminUsersPage';
import AdminRolesPage from './pages/AdminRolesPage';
import AdminStatsPage from './pages/AdminStatsPage';
import AuthPage from './pages/AuthPage';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter
      basename="/admin"
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <AuthProvider>
        <AppProvider>
          <Routes>
            <Route path="/login" element={<AuthPage registerDisabled />} />
            <Route
              element={<ProtectedRoute adminOnly><AdminLayout /></ProtectedRoute>}
            >
              <Route index element={<Navigate to="/users" replace />} />
              <Route path="/users" element={<AdminUsersPage />} />
              <Route path="/roles" element={<AdminRolesPage />} />
              <Route path="/stats" element={<AdminStatsPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/users" replace />} />
          </Routes>
        </AppProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);

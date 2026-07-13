import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';
import StorageSetup from './components/StorageSetup';
import HomePage from './pages/HomePage';
import LearningPage from './pages/LearningPage';
import VocabularyPage from './pages/VocabularyPage';
import WordDetailPage from './pages/WordDetailPage';
import DailyPracticePage from './pages/DailyPracticePage';
import StatsPage from './pages/StatsPage';
import AuthPage from './pages/AuthPage';

function MainLayout() {
  return (
    <>
      <Navbar />
      <StorageSetup />
      <main><Outlet /></main>
    </>
  );
}

function App() {
  return (
    <div className="min-h-screen bg-deep-space">
      <Routes>
        {/* 前台 */}
        <Route path="/login" element={<AuthPage />} />
        <Route element={<MainLayout />}>
          <Route path="/" element={<ProtectedRoute><HomePage /></ProtectedRoute>} />
          <Route path="/learn/:fileId" element={<ProtectedRoute><LearningPage /></ProtectedRoute>} />
          <Route path="/practice" element={<ProtectedRoute><DailyPracticePage /></ProtectedRoute>} />
          <Route path="/vocabulary/:word" element={<ProtectedRoute><WordDetailPage /></ProtectedRoute>} />
          <Route path="/vocabulary" element={<ProtectedRoute><VocabularyPage /></ProtectedRoute>} />
          <Route path="/stats" element={<ProtectedRoute><StatsPage /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </div>
  );
}

export default App;

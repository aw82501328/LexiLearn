import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login, register } from '../services/auth';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';

export default function AuthPage({ registerDisabled = false }) {
  const [mode, setMode] = useState('login'); // login | register
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const { syncFiles } = useApp();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!username.trim() || !password.trim()) {
      setError('请输入用户名和密码');
      return;
    }
    if (username.trim().length < 2) {
      setError('用户名至少 2 个字符');
      return;
    }
    if (password.length < 4) {
      setError('密码至少 4 个字符');
      return;
    }
    if (mode === 'register' && password !== confirm) {
      setError('两次密码不一致');
      return;
    }

    setLoading(true);
    try {
      const user = mode === 'login'
        ? await login(username.trim(), password)
        : await register(username.trim(), password);
      setUser(user);
      await syncFiles();
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const switchMode = () => {
    setMode(mode === 'login' ? 'register' : 'login');
    setError('');
  };

  return (
    <div className="flex items-center justify-center min-h-[80vh] px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-soft-white">
            <span className="bg-gradient-to-r from-electric-cyan to-cyan-glow bg-clip-text text-transparent">
              LexiLearn
            </span>
          </h1>
          <p className="mt-2 text-sm text-muted-gray">
            {mode === 'login' ? '登录你的账号' : '创建新账号'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-muted-gray mb-1.5">用户名</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="输入用户名"
              className="w-full rounded-lg border border-mid-slate bg-dark-slate/50 px-4 py-2.5 text-sm text-soft-white placeholder-muted-gray/50 focus:outline-none focus:border-electric-cyan/50 transition-colors"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs text-muted-gray mb-1.5">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="输入密码"
              className="w-full rounded-lg border border-mid-slate bg-dark-slate/50 px-4 py-2.5 text-sm text-soft-white placeholder-muted-gray/50 focus:outline-none focus:border-electric-cyan/50 transition-colors"
            />
          </div>

          {mode === 'register' && (
            <div>
              <label className="block text-xs text-muted-gray mb-1.5">确认密码</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="再次输入密码"
                className="w-full rounded-lg border border-mid-slate bg-dark-slate/50 px-4 py-2.5 text-sm text-soft-white placeholder-muted-gray/50 focus:outline-none focus:border-electric-cyan/50 transition-colors"
              />
            </div>
          )}

          {error && (
            <p className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-electric-cyan/10 border border-electric-cyan/20 px-4 py-2.5 text-sm font-medium text-electric-cyan hover:bg-electric-cyan/20 hover:shadow-[0_0_20px_rgba(45,212,191,0.2)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? '处理中...' : mode === 'login' ? '登录' : '注册'}
          </button>
        </form>

        {!registerDisabled && (
          <p className="mt-6 text-center text-xs text-muted-gray">
            {mode === 'login' ? '还没有账号？' : '已有账号？'}
            <button
              onClick={switchMode}
              className="ml-1 text-electric-cyan hover:text-cyan-glow underline underline-offset-4 transition-colors"
            >
              {mode === 'login' ? '立即注册' : '去登录'}
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

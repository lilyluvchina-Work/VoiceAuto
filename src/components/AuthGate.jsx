import React, { useEffect, useState } from 'react';
import {
  authenticateUser,
  getCurrentUser,
  logoutUser,
} from '../modules/config/authStore';
import { loadAllDatabaseConfigs } from '../modules/config/configApi';
import { refreshLangfuseEnvironments } from '../modules/langfuse/services/langfuseService';

export const AuthContext = React.createContext(null);

export function AuthGate({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [checkingProfile, setCheckingProfile] = useState(true);
  const [loginAccount, setLoginAccount] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let mounted = true;
    getCurrentUser()
      .then((user) => {
        if (!mounted) return;
        if (!user) {
          setCurrentUser(null);
          return;
        }
        return loadAllDatabaseConfigs()
          .then(() => refreshLangfuseEnvironments())
          .catch(() => {})
          .finally(() => {
            if (mounted) setCurrentUser(user);
          });
      })
      .finally(() => {
        if (mounted) setCheckingProfile(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const handleLogin = async (event) => {
    event.preventDefault();
    const result = await authenticateUser(loginAccount, password);
    if (!result.success) {
      setMessage(result.message || '登录失败');
      return;
    }
    await loadAllDatabaseConfigs()
      .then(() => refreshLangfuseEnvironments())
      .catch(() => {});
    setCurrentUser(result.user);
    setPassword('');
    setMessage('');
  };

  const handleLogout = async () => {
    await logoutUser();
    setCurrentUser(null);
  };

  if (checkingProfile) {
    return (
      <div className="min-h-screen bg-darker flex items-center justify-center px-4 text-sm text-gray-400">
        正在校验登录状态...
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-darker flex items-center justify-center px-4">
        <form onSubmit={handleLogin} className="w-full max-w-sm rounded-lg border border-gray-700 bg-dark p-6 shadow-2xl space-y-5">
          <div>
            <h1 className="text-xl font-bold text-white">VoiceAuto</h1>
            <p className="text-xs text-gray-400 mt-1">语音自动化测试平台</p>
          </div>
          <label className="space-y-1.5 block">
            <span className="text-xs text-gray-400">登录账号</span>
            <input
              value={loginAccount}
              onChange={(event) => setLoginAccount(event.target.value)}
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white focus:border-primary focus:ring-1 focus:ring-primary"
              autoComplete="username"
            />
          </label>
          <label className="space-y-1.5 block">
            <span className="text-xs text-gray-400">密码</span>
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white focus:border-primary focus:ring-1 focus:ring-primary"
              autoComplete="current-password"
            />
          </label>
          {message && <p className="text-sm text-red-300">{message}</p>}
          <button className="w-full px-4 py-2 rounded-lg bg-primary hover:bg-blue-500 text-sm font-medium text-white" type="submit">
            登录
          </button>
        </form>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ currentUser, logout: handleLogout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return React.useContext(AuthContext);
}

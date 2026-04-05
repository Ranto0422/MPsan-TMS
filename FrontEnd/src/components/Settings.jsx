import React, { useState, useEffect } from 'react';
import { MdSecurity, MdDevices, MdVpnKey, MdCheckCircle, MdError, MdHelpOutline } from 'react-icons/md';
import SecurityAlerts from './SecurityAlerts';
import ActiveSessions from './ActiveSessions';
import UserManual from './UserManual';
import { authFetch } from '../auth';

const Settings = ({ currentUser }) => {
    const [activeTab, setActiveTab] = useState('security');
    const [passwordForm, setPasswordForm] = useState({
        oldPassword: '',
        newPassword: '',
        confirmPassword: '',
    });
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState(null);
    const [alertsCount, setAlertsCount] = useState(0);
    const [sessionsCount, setSessionsCount] = useState(0);

    useEffect(() => {
        const fetchCounts = async () => {
            try {
                const [alertsRes, sessionsRes] = await Promise.all([
                    authFetch('/api/security-alerts/count/'),
                    authFetch('/api/sessions/count/'),
                ]);
                if (alertsRes.ok) {
                    const data = await alertsRes.json();
                    setAlertsCount(data.count || 0);
                }
                if (sessionsRes.ok) {
                    const data = await sessionsRes.json();
                    setSessionsCount(data.count || 0);
                }
            } catch (e) {
                // silently fail
            }
        };
        fetchCounts();
    }, [activeTab]);

    const handlePasswordChange = async (e) => {
        e.preventDefault();
        if (passwordForm.newPassword !== passwordForm.confirmPassword) {
            setMessage({ type: 'error', text: 'New passwords do not match' });
            return;
        }

        setLoading(true);
        setMessage(null);
        try {
            const res = await authFetch('/api/user/change-password/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    old_password: passwordForm.oldPassword,
                    new_password: passwordForm.newPassword,
                }),
            });

            const data = await res.json();
            if (res.ok) {
                setMessage({ type: 'success', text: 'Password changed successfully! All other sessions have been logged out.' });
                setPasswordForm({ oldPassword: '', newPassword: '', confirmPassword: '' });
            } else {
                setMessage({ type: 'error', text: data.error || 'Failed to change password' });
            }
        } catch (err) {
            setMessage({ type: 'error', text: 'An error occurred. Please try again.' });
        } finally {
            setLoading(false);
        }
    };

    const isAdmin = !!(currentUser && (currentUser.role === 'admin' || currentUser.is_superuser));

    const tabs = [
        { id: 'security', label: 'Security', icon: <MdSecurity className="text-lg flex-shrink-0" />, badge: alertsCount, badgeColor: 'bg-red-500' },
        { id: 'sessions', label: 'Sessions', icon: <MdDevices className="text-lg flex-shrink-0" />, badge: sessionsCount, badgeColor: 'bg-blue-500' },
        { id: 'password', label: 'Password', icon: <MdVpnKey className="text-lg flex-shrink-0" /> },
        { id: 'help', label: 'Help', icon: <MdHelpOutline className="text-lg flex-shrink-0" /> },
    ];

    return (
        <div className="max-w-4xl mx-auto px-3 py-4 md:p-6 space-y-4 md:space-y-6 overflow-x-hidden">
            <div>
                <h1 className="text-xl md:text-2xl font-black text-gray-900 dark:text-white tracking-tight">Account Settings</h1>
                <p className="text-xs md:text-sm text-gray-500 dark:text-gray-400 mt-0.5">Manage your security preferences and active sessions</p>
            </div>

            {/* Tab Navigation — scrollable on mobile */}
            <div className="overflow-x-auto -mx-3 px-3 pb-1">
                <div className="flex gap-1.5 p-1 bg-gray-100 dark:bg-gray-800/50 rounded-2xl min-w-full md:w-fit">
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => {
                                setActiveTab(tab.id);
                                setMessage(null);
                            }}
                            className={`flex items-center gap-1.5 px-3 py-2 md:px-4 md:py-2.5 rounded-xl font-bold text-xs md:text-sm transition-all duration-300 whitespace-nowrap flex-1 md:flex-none justify-center ${activeTab === tab.id
                                ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                                : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                                }`}
                        >
                            {tab.icon}
                            <span>{tab.label}</span>
                            {tab.badge > 0 && (
                                <span className={`min-w-[18px] h-[18px] px-1 flex items-center justify-center text-xs font-black rounded-full text-white ${activeTab === tab.id ? 'bg-white/25' : tab.badgeColor}`}>
                                    {tab.badge}
                                </span>
                            )}
                        </button>
                    ))}
                </div>
            </div>

            {/* Tab Content */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl md:rounded-3xl shadow-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
                {activeTab === 'security' && (
                    <div className="animate-fade-in">
                        <SecurityAlerts />
                    </div>
                )}

                {activeTab === 'sessions' && (
                    <div className="animate-fade-in">
                        <ActiveSessions />
                    </div>
                )}

                {activeTab === 'help' && (
                    <div className="animate-fade-in">
                        <UserManual isAdmin={isAdmin} />
                    </div>
                )}

                {activeTab === 'password' && (
                    <div className="animate-fade-in max-w-md mx-auto p-4 md:p-6 py-4 md:py-6">
                        <h3 className="text-lg md:text-xl font-black text-gray-900 dark:text-white mb-5">Update Password</h3>

                        {message && (
                            <div className={`mb-5 p-3 md:p-4 rounded-2xl flex items-start gap-2 ${message.type === 'success' ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
                                }`}>
                                {message.type === 'success' ? <MdCheckCircle className="text-xl flex-shrink-0 mt-0.5" /> : <MdError className="text-xl flex-shrink-0 mt-0.5" />}
                                <p className="text-sm font-bold">{message.text}</p>
                            </div>
                        )}

                        <form onSubmit={handlePasswordChange} className="space-y-4">
                            <div>
                                <label className="block text-xs font-black uppercase tracking-widest text-gray-400 mb-1.5 px-1">Current Password</label>
                                <input
                                    type="password"
                                    required
                                    value={passwordForm.oldPassword}
                                    onChange={(e) => setPasswordForm({ ...passwordForm, oldPassword: e.target.value })}
                                    className="w-full bg-gray-50 dark:bg-black/20 border-2 border-transparent focus:border-blue-500 rounded-2xl px-4 py-3 outline-none text-gray-900 dark:text-white font-bold transition-all text-sm"
                                    placeholder="••••••••"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-black uppercase tracking-widest text-gray-400 mb-1.5 px-1">New Password</label>
                                <input
                                    type="password"
                                    required
                                    value={passwordForm.newPassword}
                                    onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                                    className="w-full bg-gray-50 dark:bg-black/20 border-2 border-transparent focus:border-blue-500 rounded-2xl px-4 py-3 outline-none text-gray-900 dark:text-white font-bold transition-all text-sm"
                                    placeholder="••••••••"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-black uppercase tracking-widest text-gray-400 mb-1.5 px-1">Confirm New Password</label>
                                <input
                                    type="password"
                                    required
                                    value={passwordForm.confirmPassword}
                                    onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                                    className="w-full bg-gray-50 dark:bg-black/20 border-2 border-transparent focus:border-blue-500 rounded-2xl px-4 py-3 outline-none text-gray-900 dark:text-white font-bold transition-all text-sm"
                                    placeholder="••••••••"
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] transition-all duration-300 shadow-xl shadow-blue-600/20 active:scale-[0.98] mt-2"
                            >
                                {loading ? 'Updating...' : 'Update Password'}
                            </button>
                        </form>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Settings;

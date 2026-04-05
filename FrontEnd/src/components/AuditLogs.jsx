import React, { useState, useEffect } from 'react';
import { authFetch } from '../auth';
import { FiSearch, FiChevronLeft, FiChevronRight, FiFilter, FiActivity, FiServer, FiChevronDown, FiChevronUp, FiMail, FiMessageSquare, FiAlertTriangle } from 'react-icons/fi';

const AuditLogs = () => {
  const [activeTab, setActiveTab] = useState('activity');
  const [logs, setLogs] = useState([]);
  const [systemLogs, setSystemLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [systemLoading, setSystemLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAction, setSelectedAction] = useState('all');
  const [selectedSeverity, setSelectedSeverity] = useState('all');
  const [expandedRows, setExpandedRows] = useState(new Set());

  // Pagination state for activity logs
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Pagination state for system logs
  const [systemCurrentPage, setSystemCurrentPage] = useState(1);
  const [systemTotalPages, setSystemTotalPages] = useState(1);

  // Message logs state
  const [messageLogs, setMessageLogs] = useState([]);
  const [messageLoading, setMessageLoading] = useState(true);
  const [messageCurrentPage, setMessageCurrentPage] = useState(1);
  const [messageTotalPages, setMessageTotalPages] = useState(1);
  const [messageChannelFilter, setMessageChannelFilter] = useState('all');
  const [messageStatusFilter, setMessageStatusFilter] = useState('all');
  const [messageTypeFilter, setMessageTypeFilter] = useState('all');
  const [failedCount, setFailedCount] = useState(0);
  const [lastSeenMessages, setLastSeenMessages] = useState(
    () => localStorage.getItem('lastSeenMessagesTab') || null
  );

  const LOGS_PER_PAGE = 30;

  const toggleRowExpansion = (logId) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(logId)) {
      newExpanded.delete(logId);
    } else {
      newExpanded.add(logId);
    }
    setExpandedRows(newExpanded);
  };

  // Reset page when filters change
  useEffect(() => {
    if (activeTab === 'activity') {
      setCurrentPage(1);
    } else if (activeTab === 'system') {
      setSystemCurrentPage(1);
    } else if (activeTab === 'messages') {
      setMessageCurrentPage(1);
    }
  }, [selectedAction, searchQuery, selectedSeverity, activeTab, messageChannelFilter, messageStatusFilter, messageTypeFilter]);

  // Fetch logs when page or filters change
  useEffect(() => {
    if (activeTab === 'activity') {
      fetchLogs(currentPage);
    }
  }, [selectedAction, searchQuery, activeTab, currentPage]);

  useEffect(() => {
    if (activeTab === 'system') {
      fetchSystemLogs(systemCurrentPage);
    }
  }, [selectedSeverity, searchQuery, activeTab, systemCurrentPage]);

  // Fetch message logs
  useEffect(() => {
    if (activeTab === 'messages') {
      fetchMessageLogs(messageCurrentPage);
    }
  }, [activeTab, messageCurrentPage, messageChannelFilter, messageStatusFilter, messageTypeFilter, searchQuery]);

  // Reset badge when user visits Messages tab
  useEffect(() => {
    if (activeTab === 'messages') {
      const now = new Date().toISOString();
      setLastSeenMessages(now);
      localStorage.setItem('lastSeenMessagesTab', now);
      setFailedCount(0);
    }
  }, [activeTab]);

  // Fetch failed count for badge (only counts failures since last visit)
  useEffect(() => {
    const fetchFailedCount = async () => {
      try {
        const since = localStorage.getItem('lastSeenMessagesTab');
        const url = since
          ? `/api/message-logs/failed-count/?since=${encodeURIComponent(since)}`
          : '/api/message-logs/failed-count/';
        const res = await authFetch(url);
        if (res && res.ok) {
          const data = await res.json();
          setFailedCount(data.failed_count || 0);
        }
      } catch (e) { /* ignore */ }
    };
    fetchFailedCount();
    const interval = setInterval(fetchFailedCount, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchLogs = async (page = 1) => {
    try {
      setLoading(true);
      let url = '/api/audit-logs/';
      const params = new URLSearchParams();

      params.append('page', page.toString());

      if (selectedAction !== 'all') {
        params.append('severity', selectedAction);
      }

      if (searchQuery.trim()) {
        params.append('search', searchQuery.trim());
      }

      url += '?' + params.toString();

      const response = await authFetch(url);
      if (response && response.ok) {
        const data = await response.json();
        const results = data.results || data;
        const count = data.count || (Array.isArray(data) ? data.length : 0);

        // Filter out admin-related events from activity logs
        const adminEvents = [
          'Building Created', 'Building Deleted', 'User Created', 'User Deleted',
          'Owner Assigned', 'Owner Deassigned', 'Owner Changed', 'Manager Assigned', 'Manager Deassigned'
        ];
        const filteredData = Array.isArray(results) ? results.filter(log =>
          !adminEvents.includes(log.event)
        ) : [];

        setLogs(filteredData);
        setTotalPages(Math.ceil(count / LOGS_PER_PAGE) || 1);
      }
    } catch (error) {
      console.error('Error fetching audit logs:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchSystemLogs = async (page = 1) => {
    try {
      setSystemLoading(true);
      let url = '/api/audit-logs/';
      const params = new URLSearchParams();

      params.append('page', page.toString());

      if (selectedSeverity !== 'all') {
        params.append('severity', selectedSeverity);
      }

      if (searchQuery.trim()) {
        params.append('search', searchQuery.trim());
      }

      url += '?' + params.toString();

      const response = await authFetch(url);
      if (response && response.ok) {
        const data = await response.json();
        const results = data.results || data;
        const count = data.count || (Array.isArray(data) ? data.length : 0);

        const adminEvents = [
          'Building Created', 'Building Deleted', 'User Created', 'User Deleted',
          'Owner Assigned', 'Owner Deassigned', 'Owner Changed', 'Manager Assigned', 'Manager Deassigned'
        ];
        const filteredData = Array.isArray(results) ? results.filter(log =>
          adminEvents.includes(log.event)
        ) : [];

        setSystemLogs(filteredData);
        setSystemTotalPages(Math.ceil(count / LOGS_PER_PAGE) || 1);
      }
    } catch (error) {
      console.error('Error fetching system logs:', error);
    } finally {
      setSystemLoading(false);
    }
  };

  const fetchMessageLogs = async (page = 1) => {
    try {
      setMessageLoading(true);
      const params = new URLSearchParams();
      params.append('page', page.toString());
      if (messageChannelFilter !== 'all') params.append('channel', messageChannelFilter);
      if (messageStatusFilter !== 'all') params.append('status', messageStatusFilter);
      if (messageTypeFilter !== 'all') params.append('message_type', messageTypeFilter);
      if (searchQuery.trim()) params.append('search', searchQuery.trim());

      const response = await authFetch('/api/message-logs/?' + params.toString());
      if (response && response.ok) {
        const data = await response.json();
        const results = data.results || data;
        const count = data.count || (Array.isArray(data) ? data.length : 0);
        setMessageLogs(Array.isArray(results) ? results : []);
        setMessageTotalPages(Math.ceil(count / LOGS_PER_PAGE) || 1);
      }
    } catch (error) {
      console.error('Error fetching message logs:', error);
    } finally {
      setMessageLoading(false);
    }
  };

  const getActionStyles = (event) => {
    const eventLower = event.toLowerCase();
    if (eventLower.includes('added') || eventLower.includes('created')) {
      return { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-400', icon: 'M12 4v16m8-8H4' };
    } else if (eventLower.includes('verified')) {
      return { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-400', icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' };
    } else if (eventLower.includes('received') || eventLower.includes('payment')) {
      return { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-700 dark:text-purple-400', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z' };
    } else if (eventLower.includes('removed') || eventLower.includes('deleted')) {
      return { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-400', icon: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16' };
    } else if (eventLower.includes('updated') || eventLower.includes('edited')) {
      return { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-400', icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z' };
    }
    return { bg: 'bg-gray-100 dark:bg-gray-700', text: 'text-gray-700 dark:text-gray-400', icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' };
  };

  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp);
    return new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    }).format(date);
  };

  const extractTenantInfo = (details) => {
    const match = details.match(/tenant[:\s]+([^(]+)/i);
    return match ? match[1].trim() : null;
  };

  const LogCard = ({ log }) => {
    const styles = getActionStyles(log.event);
    const isExpanded = expandedRows.has(log.log_id);
    const tenant = extractTenantInfo(log.details);

    return (
      <div
        onClick={() => toggleRowExpansion(log.log_id)}
        className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 active:scale-[0.99] transition-all duration-200"
      >
        <div className="flex justify-between items-start mb-2">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${styles.bg} ${styles.text}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={styles.icon} /></svg>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white text-sm">{log.event}</h3>
              <p className="text-xs text-gray-400">{formatTimestamp(log.timestamp)}</p>
            </div>
          </div>
          {log.severity && (
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${log.severity === 'critical' ? 'bg-red-100 text-red-600' :
              log.severity === 'warning' ? 'bg-orange-100 text-orange-600' :
                'bg-blue-100 text-blue-600'
              }`}>
              {log.severity}
            </span>
          )}
        </div>

        <div className="mt-2 pl-[44px]">
          <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2">
            <span className="font-medium text-gray-900 dark:text-white">{log.user || 'System'}</span>
            {tenant && <> • {tenant}</>}
          </p>

          {(isExpanded || !log.user) && (
            <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 animate-fade-in-down">
              <p className="mb-1">{log.details}</p>
              {log.ip_address && <p className="font-mono opacity-75">IP: {log.ip_address}</p>}
            </div>
          )}

          {!isExpanded && (
            <div className="flex justify-center mt-1">
              <FiChevronDown className="text-gray-300 w-4 h-4" />
            </div>
          )}
        </div>
      </div>
    );
  };

  const PaginationControls = ({ current, total, onPageChange, isLoading }) => (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-2 py-4">
      <div className="flex items-center gap-2">
        <button
          onClick={() => onPageChange(1)}
          disabled={current === 1 || isLoading}
          className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 disabled:opacity-30 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          title="First Page"
        >
          <span className="sr-only">First Page</span>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg>
        </button>
        <button
          onClick={() => onPageChange(current - 1)}
          disabled={current === 1 || isLoading}
          className="flex items-center gap-1 px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm disabled:opacity-50 disabled:shadow-none transition-all active:scale-95"
        >
          <FiChevronLeft /> Prev
        </button>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-500 dark:text-gray-400">Page</span>
        <select
          value={current}
          onChange={(e) => onPageChange(Number(e.target.value))}
          disabled={isLoading}
          className="form-select block w-20 px-2 py-1 text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500"
        >
          {Array.from({ length: total }, (_, i) => i + 1).map((page) => (
            <option key={page} value={page}>{page}</option>
          ))}
        </select>
        <span className="text-sm text-gray-500 dark:text-gray-400">of {total}</span>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => onPageChange(current + 1)}
          disabled={current === total || isLoading}
          className="flex items-center gap-1 px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm disabled:opacity-50 disabled:shadow-none transition-all active:scale-95"
        >
          Next <FiChevronRight />
        </button>
        <button
          onClick={() => onPageChange(total)}
          disabled={current === total || isLoading}
          className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 disabled:opacity-30 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          title="Last Page"
        >
          <span className="sr-only">Last Page</span>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg>
        </button>
      </div>
    </div>
  );

  return (
    <div className="bg-gray-50/50 dark:bg-gray-900 section-transition overflow-x-hidden pb-6">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">

        {/* Header & Tabs */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">Activity Logs</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Track system events and user actions</p>
          </div>

          {/* Segmented Control */}
          <div className="bg-gray-200/50 dark:bg-gray-800 p-1 rounded-xl inline-flex self-start sm:self-auto flex-wrap">
            {['activity', 'system', 'messages'].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 capitalize flex items-center gap-2 ${activeTab === tab
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm scale-[1.02]'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                  }`}
              >
                {tab === 'activity' ? <FiActivity className="w-4 h-4" /> : tab === 'system' ? <FiServer className="w-4 h-4" /> : <FiMessageSquare className="w-4 h-4" />}
                {tab}
                {tab === 'messages' && failedCount > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full leading-none">{failedCount}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Sticky Search & Filter Bar */}
        <div className="sticky top-0 z-20 pb-4 -mx-4 px-4 bg-gray-50/95 dark:bg-gray-900/95 backdrop-blur-sm transition-all">
          <div className="flex flex-col sm:flex-row gap-2 sm:flex-wrap">
            <div className="relative flex-1 sm:min-w-[200px]">
              <FiSearch className="absolute left-3.5 top-3 text-gray-400" />
              <input
                type="text"
                placeholder={activeTab === 'messages' ? "Search recipient or name..." : "Search logs..."}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all placeholder:text-gray-400 text-sm"
              />
            </div>
            {activeTab === 'messages' ? (
              <div className="flex gap-2 flex-1">
                <div className="relative flex-1">
                  <select
                    value={messageChannelFilter}
                    onChange={(e) => setMessageChannelFilter(e.target.value)}
                    className="w-full pl-3 pr-8 py-2.5 h-full text-gray-900 dark:text-white bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none text-sm appearance-none"
                  >
                    <option value="all">All Channels</option>
                    <option value="sms">SMS</option>
                    <option value="email">Email</option>
                    <option value="push">Push</option>
                  </select>
                  <FiChevronDown className="absolute right-3 top-3.5 text-gray-400 pointer-events-none w-3 h-3" />
                </div>
                <div className="relative flex-1">
                  <select
                    value={messageStatusFilter}
                    onChange={(e) => setMessageStatusFilter(e.target.value)}
                    className="w-full pl-3 pr-8 py-2.5 h-full text-gray-900 dark:text-white bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none text-sm appearance-none"
                  >
                    <option value="all">All Status</option>
                    <option value="sent">Sent</option>
                    <option value="failed">Failed</option>
                  </select>
                  <FiChevronDown className="absolute right-3 top-3.5 text-gray-400 pointer-events-none w-3 h-3" />
                </div>
                <div className="relative flex-1">
                  <select
                    value={messageTypeFilter}
                    onChange={(e) => setMessageTypeFilter(e.target.value)}
                    className="w-full pl-3 pr-8 py-2.5 h-full text-gray-900 dark:text-white bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none text-sm appearance-none"
                  >
                    <option value="all">All Types</option>
                    <option value="manual">Manual</option>
                    <option value="mass">Mass</option>
                    <option value="automated">Automated</option>
                    <option value="payment_confirmation">Payment</option>
                    <option value="test">Test</option>
                  </select>
                  <FiChevronDown className="absolute right-3 top-3.5 text-gray-400 pointer-events-none w-3 h-3" />
                </div>
              </div>
            ) : (
              <div className="relative">
                <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                  <FiFilter className="text-gray-400" />
                </div>
                <select
                  value={activeTab === 'system' ? selectedSeverity : selectedAction}
                  onChange={(e) => activeTab === 'system' ? setSelectedSeverity(e.target.value) : setSelectedAction(e.target.value)}
                  className="pl-9 pr-8 py-2.5 h-full text-gray-900 dark:text-white bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none text-sm appearance-none sm:min-w-[140px]"
                >
                  <option value="all">All</option>
                  <option value="info">Info</option>
                  <option value="warning">Warning</option>
                  <option value="critical">Critical</option>
                </select>
                <FiChevronDown className="absolute right-3 top-3.5 text-gray-400 pointer-events-none w-3 h-3" />
              </div>
            )}
          </div>
        </div>

        {/* Content Area */}
        <div className="space-y-4">
          {activeTab === 'messages' ? (
            /* ---- MESSAGE LOGS TAB ---- */
            messageLoading ? (
              <div className="py-20 flex flex-col items-center justify-center text-gray-400">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mb-4"></div>
                <span className="text-sm">Loading message logs...</span>
              </div>
            ) : messageLogs.length === 0 ? (
              <div className="py-20 text-center text-gray-400 bg-white dark:bg-gray-800 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700">
                <FiMessageSquare className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>No message logs found</p>
              </div>
            ) : (
              <>
                {/* Desktop Table */}
                <div className="hidden lg:block bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-gray-50/80 dark:bg-gray-900/30 backdrop-blur">
                      <tr>
                        <th className="px-5 py-4 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                        <th className="px-5 py-4 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Channel</th>
                        <th className="px-5 py-4 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Type</th>
                        <th className="px-5 py-4 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Recipient</th>
                        <th className="px-5 py-4 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Message</th>
                        <th className="px-5 py-4 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Sent By</th>
                        <th className="px-5 py-4 text-right text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
                      {messageLogs.map((msg) => (
                        <tr key={msg.id} className={`hover:bg-gray-50/80 dark:hover:bg-gray-700/30 transition-colors ${msg.status === 'failed' ? 'bg-red-50/50 dark:bg-red-900/10' : ''}`}>
                          <td className="px-5 py-3.5">
                            {msg.status === 'sent' ? (
                              <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs font-bold rounded-lg">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                                Sent
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 text-xs font-bold rounded-lg">
                                <FiAlertTriangle className="w-3 h-3" />
                                Failed
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-3.5">
                            <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${msg.channel === 'sms' ? 'text-blue-600 dark:text-blue-400' : msg.channel === 'email' ? 'text-purple-600 dark:text-purple-400' : 'text-orange-600 dark:text-orange-400'}`}>
                              {msg.channel === 'sms' ? <FiMessageSquare className="w-3.5 h-3.5" /> : msg.channel === 'email' ? <FiMail className="w-3.5 h-3.5" /> : '🔔'}
                              {msg.channel.toUpperCase()}
                            </span>
                          </td>
                          <td className="px-5 py-3.5">
                            <span className="text-xs font-medium text-gray-600 dark:text-gray-400 capitalize">{msg.message_type.replace('_', ' ')}</span>
                          </td>
                          <td className="px-5 py-3.5">
                            <div className="text-sm font-medium text-gray-900 dark:text-white">{msg.tenant_name || msg.recipient}</div>
                            {msg.tenant_name && <div className="text-xs text-gray-400 font-mono">{msg.recipient}</div>}
                            {msg.room_number && <div className="text-xs text-gray-400">Room {msg.room_number}</div>}
                          </td>
                          <td className="px-5 py-3.5 max-w-[300px]">
                            <div className={`text-sm text-gray-600 dark:text-gray-400 ${expandedRows.has(`msg-${msg.id}`) ? '' : 'line-clamp-2'}`}>
                              {msg.message}
                            </div>
                            {msg.status === 'failed' && msg.error_message && (
                              <div className="mt-1 text-xs text-red-500 dark:text-red-400 font-medium">{msg.error_message}</div>
                            )}
                            {msg.message && msg.message.length > 120 && (
                              <button
                                onClick={() => toggleRowExpansion(`msg-${msg.id}`)}
                                className="text-xs font-medium text-blue-600 dark:text-blue-400 mt-1 hover:underline"
                              >
                                {expandedRows.has(`msg-${msg.id}`) ? 'Less' : 'More'}
                              </button>
                            )}
                          </td>
                          <td className="px-5 py-3.5 text-sm text-gray-600 dark:text-gray-400">{msg.sent_by_username}</td>
                          <td className="px-5 py-3.5 text-right whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 tabular-nums">
                            {formatTimestamp(msg.created_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Card View */}
                <div className="lg:hidden grid gap-3 min-w-0">
                  {messageLogs.map((msg) => (
                    <div key={msg.id} className={`bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border overflow-hidden ${msg.status === 'failed' ? 'border-red-200 dark:border-red-800' : 'border-gray-100 dark:border-gray-700'}`}>
                      <div className="flex justify-between items-start mb-2 gap-2">
                        <div className="flex items-center gap-2 flex-wrap min-w-0">
                          {msg.status === 'sent' ? (
                            <span className="px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-[10px] font-bold rounded-md uppercase">Sent</span>
                          ) : (
                            <span className="px-2 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 text-[10px] font-bold rounded-md uppercase">Failed</span>
                          )}
                          <span className={`px-2 py-0.5 text-[10px] font-bold rounded-md uppercase ${msg.channel === 'sms' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' : 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400'}`}>
                            {msg.channel}
                          </span>
                          <span className="text-[10px] text-gray-400 capitalize">{msg.message_type.replace('_', ' ')}</span>
                        </div>
                        <span className="text-xs text-gray-400 flex-shrink-0">{formatTimestamp(msg.created_at)}</span>
                      </div>
                      <h3 className="font-semibold text-gray-900 dark:text-white text-sm truncate">{msg.tenant_name || msg.recipient}</h3>
                      {msg.tenant_name && <p className="text-xs text-gray-400 font-mono truncate">{msg.recipient}</p>}
                      {msg.room_number && <p className="text-xs text-gray-400">Room {msg.room_number}</p>}
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-2 line-clamp-3 break-words">{msg.message}</p>
                      {msg.status === 'failed' && msg.error_message && (
                        <p className="mt-2 text-xs text-red-500 dark:text-red-400 font-medium bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded break-all">{msg.error_message}</p>
                      )}
                      <p className="text-xs text-gray-400 mt-2">By: {msg.sent_by_username}</p>
                    </div>
                  ))}
                </div>

                <PaginationControls
                  current={messageCurrentPage}
                  total={messageTotalPages}
                  onPageChange={setMessageCurrentPage}
                  isLoading={messageLoading}
                />
              </>
            )
          ) : (
            /* ---- ACTIVITY / SYSTEM TABS ---- */
            ((activeTab === 'activity' && loading) || (activeTab === 'system' && systemLoading)) ? (
              <div className="py-20 flex flex-col items-center justify-center text-gray-400">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mb-4"></div>
                <span className="text-sm">Loading logs...</span>
              </div>
            ) : ((activeTab === 'activity' ? logs : systemLogs).length === 0) ? (
              <div className="py-20 text-center text-gray-400 bg-white dark:bg-gray-800 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700">
                <p>No {activeTab} logs found</p>
              </div>
            ) : (
              <>
                {/* Desktop Table View (Hidden on Mobile/Tablet) */}
                <div className="hidden lg:block bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-gray-50/80 dark:bg-gray-900/30 backdrop-blur">
                      <tr>
                        <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Event</th>
                        <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">User</th>
                        <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Details</th>
                        <th className="px-6 py-4 text-right text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
                      {(activeTab === 'activity' ? logs : systemLogs).map((log) => {
                        const styles = getActionStyles(log.event);
                        const tenant = extractTenantInfo(log.details);
                        return (
                          <tr key={log.log_id} className="hover:bg-gray-50/80 dark:hover:bg-gray-700/30 transition-colors group">
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className={`p-2 rounded-lg ${styles.bg} ${styles.text} ring-1 ring-inset ring-black/5 dark:ring-white/10`}>
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={styles.icon} /></svg>
                                </div>
                                <div>
                                  <div className="text-sm font-semibold text-gray-900 dark:text-white">{log.event}</div>
                                  {log.severity && log.severity !== 'info' && (
                                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide mt-0.5 ${log.severity === 'critical' ? 'bg-red-50 text-red-600' : 'bg-orange-50 text-orange-600'
                                      }`}>
                                      {log.severity}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <div className="text-sm font-medium text-gray-700 dark:text-gray-200">{log.user || 'System'}</div>
                              <div className="text-xs text-gray-400 font-mono">{log.ip_address}</div>
                            </td>
                            <td className="px-6 py-4">
                              <div className={`text-sm text-gray-600 dark:text-gray-400 ${expandedRows.has(log.log_id) ? '' : 'line-clamp-2'}`}>
                                {tenant && <span className="font-medium text-blue-600 dark:text-blue-400 mr-1.5">{tenant} •</span>}
                                {log.details}
                              </div>
                              {log.details && log.details.length > 180 && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleRowExpansion(log.log_id);
                                  }}
                                  className="text-xs font-medium text-blue-600 dark:text-blue-400 mt-1.5 hover:underline focus:outline-none"
                                >
                                  {expandedRows.has(log.log_id) ? 'View Less' : 'View More'}
                                </button>
                              )}
                            </td>
                            <td className="px-6 py-4 text-right whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 tabular-nums">
                              {formatTimestamp(log.timestamp)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile/Tablet Card List View */}
                <div className="lg:hidden grid gap-3">
                  {(activeTab === 'activity' ? logs : systemLogs).map((log) => (
                    <LogCard key={log.log_id} log={log} />
                  ))}
                </div>

                {/* Pagination */}
                <PaginationControls
                  current={activeTab === 'activity' ? currentPage : systemCurrentPage}
                  total={activeTab === 'activity' ? totalPages : systemTotalPages}
                  onPageChange={(page) => activeTab === 'activity' ? setCurrentPage(page) : setSystemCurrentPage(page)}
                  isLoading={activeTab === 'activity' ? loading : systemLoading}
                />
              </>
            )
          )}
        </div>
      </div>
    </div>
  );
};

export default AuditLogs;

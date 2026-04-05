import React, { useEffect, useState, useRef } from "react";
import { FiMenu, FiX, FiChevronLeft, FiChevronRight, FiLogOut, FiShield } from "react-icons/fi";
import PropTypes from "prop-types";
import { FaHome } from "react-icons/fa";
import { BiBarChart } from "react-icons/bi";
import { BiSolidReport } from "react-icons/bi";
import { MdMessage, MdSettings } from "react-icons/md";
import { RxActivityLog } from "react-icons/rx";
import { HiOfficeBuilding } from "react-icons/hi";
import PropertyList from './PropertyList.jsx'
import { clearTokens, authFetch } from '../auth'
import ThemeToggle from './ThemeToggle.jsx'





const Sidebar = ({ className, UserName, UserRole, currentUser, isOpen, onToggle, onNavigate, currentRoute }) => {
  const [isMobile, setIsMobile] = useState(false);
  const [isAdmin, setIsAdmin] = useState(!!(currentUser && currentUser.role === 'admin'));
  const [showMoreOverlay, setShowMoreOverlay] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isNavVisible, setIsNavVisible] = useState(true);
  const lastScrollY = useRef(0);
  const [sessionsCount, setSessionsCount] = useState(0);
  const [alertsCount, setAlertsCount] = useState(0);

  useEffect(() => {
    setIsAdmin(!!(currentUser && currentUser.role === 'admin'))
  }, [currentUser])

  // Fetch counts for badges
  useEffect(() => {
    const fetchCounts = async () => {
      if (!currentUser) return;

      try {
        const [sessionsRes, alertsRes] = await Promise.all([
          authFetch('/api/sessions/count/'),
          authFetch('/api/security-alerts/count/')
        ]);

        if (sessionsRes.ok) {
          const data = await sessionsRes.json();
          setSessionsCount(data.count);
        }

        if (alertsRes.ok) {
          const data = await alertsRes.json();
          setAlertsCount(data.count);
        }
      } catch (e) {
        console.error('Failed to fetch counts:', e);
      }
    };

    fetchCounts();

    // Refresh counts every 10 seconds
    const interval = setInterval(fetchCounts, 10000);

    return () => clearInterval(interval);
  }, [currentUser])

  useEffect(() => {
    let prevWidth = window.innerWidth;
    const isMobileNow = prevWidth < 768;
    setIsMobile(isMobileNow);

    const handleResize = () => {
      const currentWidth = window.innerWidth;
      const currentlyMobile = currentWidth < 768;
      const wasPrevMobile = prevWidth < 768;

      setIsMobile(currentlyMobile);

      if (wasPrevMobile && !currentlyMobile) {
        onToggle(true);
      }
      prevWidth = currentWidth;
    };

    const handleScroll = () => {
      if (window.innerWidth >= 768) return;
      const currentScrollY = window.scrollY;

      // Show if scrolling up, hide if scrolling down
      if (currentScrollY > lastScrollY.current && currentScrollY > 60) {
        setIsNavVisible(false);
        setShowMoreOverlay(false); // Close overlay if open
      } else {
        setIsNavVisible(true);
      }
      lastScrollY.current = currentScrollY;
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  const navigationItems = isAdmin ? [
    { id: 5, name: "Logs", icon: <RxActivityLog />, path: "/activity-logs" },
    { id: 9, name: "Settings", icon: <MdSettings />, path: "/settings" },
  ] : [
    { id: 1, name: "Home", icon: <FaHome />, path: "/home" },
    { id: 2, name: "Dashboard", icon: <BiBarChart />, path: "/dashboard" },
    { id: 3, name: "Reports", icon: <BiSolidReport />, path: "/reports" },
    { id: 4, name: "Message", icon: <MdMessage />, path: "/message" },
    { id: 5, name: "Logs", icon: <RxActivityLog />, path: "/activity-logs" },
    { id: 9, name: "Settings", icon: <MdSettings />, path: "/settings" },
  ];

  // Mobile bottom nav: exclude Logs & Settings (they go in the profile overlay)
  const mobileNavItems = isAdmin
    ? [{ id: 8, name: "Admin", icon: <BiSolidReport />, path: "/admin" }, ...navigationItems.filter(item => item.id !== 9)]
    : navigationItems.filter(item => item.id !== 5 && item.id !== 9);

  const getActiveItemFromRoute = (route) => {
    if (isAdmin && route === '/admin') return 8;
    const item = navigationItems.find(i => i.path === route);
    if (item) return item.id;
    if (route === '/activity-logs') return 5;
    if (route === '/active-sessions') return 9;
    if (route === '/security-alerts') return 9;
    if (route === '/settings') return 9;
    return navigationItems[0]?.id || null;
  };

  const [activeItem, setActiveItem] = useState(() => getActiveItemFromRoute(currentRoute));

  useEffect(() => {
    const newActive = getActiveItemFromRoute(currentRoute);
    if (newActive !== activeItem) {
      setActiveItem(newActive);
    }
  }, [currentRoute]);

  const handleItemClick = (id) => {
    setActiveItem(id);
    // if (isMobile) onToggle(false); // Removed as mobile sidebar is gone
    const item = navigationItems.find((i) => i.id === id)
    if (item) {
      if (typeof onNavigate === 'function') onNavigate(item.path)
    } else if (id === 5) {
      if (typeof onNavigate === 'function') onNavigate('/activity-logs')
    } else if (id === 8) {
      if (typeof onNavigate === 'function') onNavigate('/admin')
    } else if (id === 9) {
      if (typeof onNavigate === 'function') onNavigate('/settings')
    }
    setShowMoreOverlay(false); // Close overlay on nav item click
  };

  return (
    <div className={className}>
      {/* MOBILE BOTTOM NAVIGATION */}
      <nav className={`fixed left-0 right-0 h-20 bg-white/80 dark:bg-[#0f172a]/80 backdrop-blur-2xl border-t border-gray-200 dark:border-gray-800/50 z-[60] flex items-center justify-around px-4 pb-safe shadow-[0_-10px_40px_rgba(0,0,0,0.1)] transition-transform duration-500 md:hidden ${isNavVisible ? "translate-y-0" : "translate-y-full"
        }`} style={{ bottom: 0 }}>
        {mobileNavItems.map((item) => {
          const isActive = activeItem === item.id;
          return (
            <button
              key={item.id}
              onClick={() => handleItemClick(item.id)}
              className={`flex flex-col items-center justify-center gap-1 transition-all duration-300 relative ${isActive ? "text-blue-600 dark:text-blue-400" : "text-gray-400"
                }`}
            >
              <span className={`text-2xl transition-transform duration-300 ${isActive ? "scale-110 -translate-y-1" : ""}`}>
                {item.icon}
              </span>
              <span className={`text-[9px] font-bold uppercase tracking-tighter transition-all duration-300 ${isActive ? "opacity-100" : "opacity-0 scale-50"}`}>
                {item.name}
              </span>
              {isActive && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-8 h-1 bg-blue-600 dark:bg-blue-400 rounded-full shadow-[0_0_10px_rgba(37,99,235,0.5)]"></div>
              )}
            </button>
          );
        })}

        {/* Mobile Profile/More Button */}
        <button
          onClick={() => setShowMoreOverlay(!showMoreOverlay)}
          className={`flex flex-col items-center justify-center gap-1 transition-all duration-300 ${showMoreOverlay ? "text-blue-600" : "text-gray-400"
            }`}
        >
          <div className={`relative ${showMoreOverlay ? "scale-110 -translate-y-1" : ""}`}>
            <img
              src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e"
              alt="Profile"
              className={`w-7 h-7 rounded-full border-2 transition-all ${showMoreOverlay ? "border-blue-500" : "border-transparent"
                }`}
            />
            <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 border-2 border-white dark:border-[#0f172a] rounded-full"></div>
          </div>
          <span className={`text-[10px] font-bold uppercase tracking-tighter ${showMoreOverlay ? "opacity-100" : "opacity-0 scale-50"}`}>More</span>
        </button>
      </nav>

      {/* MOBILE MORE OVERLAY */}
      {isMobile && (
        <div
          className={`fixed inset-0 z-[70] transition-all duration-500 ${showMoreOverlay ? "visible opacity-100" : "invisible opacity-0"
            }`}
        >
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowMoreOverlay(false)} />
          <div className={`absolute bottom-24 left-4 right-4 bg-white dark:bg-[#1e293b] rounded-3xl p-6 shadow-2xl border border-gray-100 dark:border-gray-800 transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${showMoreOverlay ? "translate-y-0 scale-100" : "translate-y-20 scale-95"
            }`}>
            <div className="flex items-center gap-4 mb-6">
              <img
                src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e"
                alt="Profile"
                className="w-16 h-16 rounded-2xl object-cover border-4 border-blue-500/10"
              />
              <div>
                <h3 className="text-xl font-black text-gray-900 dark:text-white leading-none">{UserName}</h3>
                <p className="text-xs font-bold text-blue-600 uppercase tracking-widest mt-2">{UserRole}</p>
                <p className="text-[10px] text-gray-400 mt-1 dark:text-gray-500">Managing {currentUser?.properties_count || 0} Properties</p>
              </div>
            </div>

            <div className="space-y-3">

              {!isAdmin && (
                <button
                  onClick={() => handleItemClick(5)}
                  className="w-full flex items-center gap-3 px-5 py-4 bg-gray-50 dark:bg-black/20 rounded-2xl font-bold text-sm text-gray-700 dark:text-gray-200 transition-all active:scale-95"
                >
                  <RxActivityLog className="text-xl text-blue-600" />
                  <span>Activity Logs</span>
                </button>
              )}

              <button
                onClick={() => handleItemClick(9)}
                className="w-full flex items-center gap-3 px-5 py-4 bg-gray-50 dark:bg-black/20 rounded-2xl font-bold text-sm text-gray-700 dark:text-gray-200 transition-all active:scale-95"
              >
                <MdSettings className="text-xl text-blue-600" />
                <span>Settings</span>
              </button>

              <div className="p-1 bg-gray-50 dark:bg-black/20 rounded-2xl">
                <ThemeToggle isCollapsed={false} />
              </div>

              <button
                onClick={() => setShowLogoutConfirm(true)}
                className="w-full flex items-center justify-between px-5 py-4 bg-red-50 dark:bg-red-900/10 text-red-600 rounded-2xl font-black text-sm transition-active active:scale-95"
              >
                <span>Logout</span>
                <FiLogOut strokeWidth={3} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DESKTOP SIDEBAR */}
      {!isMobile && (
        <aside
          className={`fixed top-0 left-0 h-full bg-white dark:bg-[#0f172a] border-r border-gray-200 dark:border-gray-800/50 shadow-2xl transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] z-[70] ${isOpen ? "w-64 translate-x-0" : "w-20 translate-x-0 md:translate-x-0"
            }`}
        >
          <div className="flex flex-col h-full relative overflow-hidden">
            {/* Subtle background glow */}
            {isOpen && (
              <div className="absolute top-0 left-0 w-full h-full pointer-events-none opacity-20 dark:opacity-30">
                <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-blue-500/30 blur-[100px] rounded-full"></div>
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-500/20 blur-[80px] rounded-full"></div>
              </div>
            )}

            {/* Logo / Header Section */}
            <div className={`flex items-center h-20 px-6 border-b border-gray-100 dark:border-gray-800/50 flex-shrink-0 transition-all duration-300 ${!isOpen && "md:px-0 md:justify-center"}`}>
              <div className={`p-2 bg-blue-600 rounded-xl shadow-lg shadow-blue-500/20 flex items-center justify-center transition-transform hover:rotate-3 active:scale-95 ${!isOpen && "md:p-1.5"}`}>
                <HiOfficeBuilding className={`text-white transition-all ${isOpen ? "w-6 h-6" : "w-7 h-7"}`} />
              </div>
              {isOpen && (
                <div className="ml-3 overflow-hidden">
                  <span className="text-xl font-black tracking-tighter text-gray-900 dark:text-white block leading-none">MPSAN</span>
                  <span className="text-[10px] font-bold text-blue-600 uppercase tracking-widest mt-0.5 block">TMS</span>
                </div>
              )}
            </div>

            {/* Nav Items Section */}
            <nav className="flex-1 overflow-y-auto overflow-x-hidden py-6 custom-scrollbar scroll-smooth">
              <ul className="space-y-1.5 px-3">
                {isAdmin && (
                  <li key="admin">
                    <button
                      onClick={() => {
                        setActiveItem(8)
                        if (typeof onNavigate === 'function') onNavigate('/admin')
                      }}
                      className={`w-full group flex items-center px-3.5 py-3 rounded-2xl transition-all duration-300 relative overflow-hidden ${activeItem === 8
                        ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20"
                        : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800/50 hover:text-gray-900 dark:hover:text-white"
                        }`}
                    >
                      <span className={`flex-shrink-0 flex items-center justify-center transition-transform duration-300 ${activeItem === 8 ? "scale-110" : "group-hover:scale-110"}`}>
                        <BiSolidReport className="text-2xl" />
                      </span>
                      {isOpen && (
                        <span className="ml-3.5 text-sm font-bold tracking-wide">Admin Dashboard</span>
                      )}
                      {activeItem === 8 && (
                        <div className="absolute right-0 top-0 bottom-0 w-1 bg-white/30 rounded-l-full"></div>
                      )}
                    </button>
                  </li>
                )}

                {navigationItems.map((item) => {
                  const isActive = activeItem === item.id;
                  return (
                    <li key={item.id} className="relative group">
                      <button
                        onClick={() => handleItemClick(item.id)}
                        className={`w-full flex items-center px-3.5 py-3 rounded-2xl transition-all duration-500 relative overflow-hidden ${isActive
                          ? "bg-blue-600 text-white shadow-xl shadow-blue-600/20 translate-x-1"
                          : "text-gray-500 dark:text-gray-400 hover:bg-blue-50 dark:hover:bg-blue-900/10 hover:text-blue-600 dark:hover:text-blue-400"
                          }`}
                        aria-current={isActive ? "page" : undefined}
                      >
                        <span className={`flex-shrink-0 flex items-center justify-center text-2xl transition-all duration-300 ${isActive ? "scale-110" : "group-hover:scale-110"}`}>
                          {item.icon}
                        </span>
                        {isOpen && (
                          <span className={`ml-3.5 text-sm font-bold tracking-wide transition-all duration-300 ${isActive ? "opacity-100" : "opacity-80 group-hover:opacity-100"}`}>
                            {item.name}
                          </span>
                        )}
                        {isActive && (
                          <div className="absolute right-0 top-1.5 bottom-1.5 w-1 bg-white/40 rounded-l-full"></div>
                        )}
                      </button>
                      {!isOpen && (
                        <div className="absolute left-full ml-4 px-3 py-1.5 bg-gray-900 text-white text-xs font-bold rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-[100] whitespace-nowrap shadow-2xl">
                          {item.name}
                        </div>
                      )}
                    </li>
                  );
                })}

              </ul>
            </nav>

            {/* Footer Section - Profile & Controls */}
            <div className="p-3 mt-auto space-y-2 border-t border-gray-100 dark:border-gray-800/50 bg-gray-50/30 dark:bg-black/10 backdrop-blur-sm flex-shrink-0">
              <div className="px-1">
                <ThemeToggle isCollapsed={!isOpen} />
              </div>

              <button
                onClick={() => setShowLogoutConfirm(true)}
                className="w-full group flex items-center px-3.5 py-3 rounded-2xl transition-all duration-300 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10"
              >
                <span className="flex-shrink-0 text-xl transition-transform group-hover:-translate-x-1">
                  <FiLogOut strokeWidth={2.5} />
                </span>
                {isOpen && <span className="ml-3.5 text-sm font-bold tracking-wide">Logout</span>}
              </button>

              <div className={`mt-2 p-2.5 bg-white dark:bg-[#1e293b] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 transition-all ${!isOpen && "md:p-1.5"}`}>
                <div className="flex items-center gap-3">
                  <img
                    src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e"
                    alt="User Profile"
                    className={`rounded-xl object-cover border-2 border-blue-500/10 transition-all ${isOpen ? "h-11 w-11" : "h-9 w-9"}`}
                  />
                  {isOpen && (
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-black text-gray-900 dark:text-white truncate leading-none">{UserName}</p>
                      <p className="text-[10px] font-bold text-blue-600 dark:text-blue-400 mt-1 uppercase tracking-wider truncate">{UserRole}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Desktop Toggle Handle */}
          <button
            onClick={() => onToggle(!isOpen)}
            className="absolute -right-3.5 top-24 bg-white dark:bg-[#1e293b] text-blue-600 rounded-xl p-1.5 border border-gray-200 dark:border-gray-800 cursor-pointer shadow-xl transition-all hover:scale-110 hover:-translate-y-0.5 active:scale-90 z-50 flex items-center justify-center"
            aria-label="Toggle Sidebar"
          >
            {isOpen ? <FiChevronLeft size={16} strokeWidth={3} /> : <FiChevronRight size={16} strokeWidth={3} />}
          </button>
        </aside>
      )}

      {/* LOGOUT CONFIRMATION MODAL */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-fade-in"
            onClick={() => setShowLogoutConfirm(false)}
          />
          <div className="bg-white dark:bg-[#1e293b] rounded-[2rem] p-8 shadow-2xl border border-gray-100 dark:border-gray-800 w-full max-w-sm relative z-10 animate-fade-in scale-100">
            <div className="text-center">
              <div className="w-20 h-20 bg-red-100 dark:bg-red-900/30 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-red-500/10">
                <FiLogOut className="text-3xl text-red-600 dark:text-red-400" />
              </div>
              <h3 className="text-2xl font-black text-gray-900 dark:text-white mb-2 tracking-tight">Logging Out?</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-8 px-4">
                Are you sure you want to end your current session? You'll need to sign in again to access your properties.
              </p>

              <div className="space-y-3">
                <button
                  onClick={() => {
                    clearTokens()
                    window.location.href = '/'
                  }}
                  className="w-full py-4 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] transition-all duration-300 shadow-xl shadow-red-600/20 active:scale-[0.98]"
                >
                  Secure Logout
                </button>
                <button
                  onClick={() => setShowLogoutConfirm(false)}
                  className="w-full py-4 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-2xl font-black text-xs uppercase tracking-[0.2em] transition-all duration-300 active:scale-[0.98]"
                >
                  Stay Signed In
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

Sidebar.propTypes = {
  className: PropTypes.string,
  UserName: PropTypes.string,
  UserRole: PropTypes.string,
  isOpen: PropTypes.bool.isRequired,
  onToggle: PropTypes.func.isRequired,
  onNavigate: PropTypes.func,
  currentRoute: PropTypes.string,
  currentUser: PropTypes.object
};

export default Sidebar;
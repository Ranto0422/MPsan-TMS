import { useState, useEffect } from 'react'
import Sidebar from './components/SideBar.jsx'
import { authFetch, clearTokens } from './auth'
import PropertyList from './components/PropertyList.jsx'
import OccupancyMap from './components/OccupancyMap.jsx'
import MobileRoomList from './components/MobileRoomList.jsx'
import Login from './components/Login.jsx'
import AdminPanel from './components/AdminPanel.jsx'
import AddTenant from './components/AddTenant.jsx'
import AuditLogs from './components/AuditLogs.jsx'
import Reports from './components/Reports.jsx'
import TenantProfile from './components/TenantProfile.jsx'
import MassMessage from './components/MassMessage.jsx'
import Dashboard from './components/Dashboard.jsx'
import ActiveSessions from './components/ActiveSessions.jsx'
import SecurityAlerts from './components/SecurityAlerts.jsx'
import Settings from './components/Settings.jsx'

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      const raw = localStorage.getItem('sidebarOpen')
      if (raw === 'false') return false
      if (raw === 'true') return true
    } catch (e) { }
    return true
  })
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  const [currentProperty, setCurrentProperty] = useState(() => {
    try {
      const saved = localStorage.getItem('currentProperty')
      return saved ? JSON.parse(saved) : null
    } catch (e) { return null }
  })
  const [properties, setProperties] = useState([])
  const [loggedIn, setLoggedIn] = useState(() => {
    try { return !!localStorage.getItem('access_token') } catch (e) { return false }
  })
  const [currentUser, setCurrentUser] = useState(null)
  const [meLoading, setMeLoading] = useState(false)

  const marginClass = sidebarOpen ? 'ml-0 md:ml-64' : 'ml-0 md:ml-20'
  const [route, setRoute] = useState(() => {
    try {
      const saved = localStorage.getItem('currentRoute')
      // Only restore certain routes (not add-tenant which needs context)
      if (saved && ['/home', '/dashboard', '/reports', '/activity-logs', '/message', '/active-sessions', '/security-alerts', '/settings'].includes(saved)) {
        return saved
      }
    } catch (e) { }
    return '/home'
  })
  const [rooms, setRooms] = useState([])
  const [addTenantDefaultRoom, setAddTenantDefaultRoom] = useState('')
  const [addTenantFloor, setAddTenantFloor] = useState(null)
  const [addTenantRoomType, setAddTenantRoomType] = useState('room')
  const [layoutsRefreshKey, setLayoutsRefreshKey] = useState(0)
  const [viewingTenantId, setViewingTenantId] = useState(null)
  const [tenantProfileReturnRoute, setTenantProfileReturnRoute] = useState('/home')

  const openAddTenant = async (roomNumber = '', mapRooms = [], floor = null, roomType = 'room') => {
    if (currentProperty?.is_archived) return
    setRoute('/add-tenant')
    setAddTenantDefaultRoom(roomNumber || '')
    setAddTenantFloor(floor)
    setAddTenantRoomType(roomType)
    try {
      let backendRooms = []
      if (currentProperty && currentProperty.id) {
        // Pass floor parameter to filter rooms by floor
        const floorParam = floor ? `?floor=${floor}` : ''
        const res = await authFetch(`/api/properties/${currentProperty.id}/rooms/${floorParam}`)
        if (res && res.ok) {
          const data = await res.json()
          backendRooms = Array.isArray(data) ? data : []
        }
      }
      // merge backend rooms with rooms from the map (mapRooms may include unsaved layout rooms)
      const mergedSet = new Set([...(backendRooms || []), ...(mapRooms || [])].map(r => String(r)))
      const merged = Array.from(mergedSet)
      // sort numerically when possible, otherwise fallback to locale string compare
      merged.sort((a, b) => {
        const an = Number(a)
        const bn = Number(b)
        const aIsNum = !Number.isNaN(an)
        const bIsNum = !Number.isNaN(bn)
        if (aIsNum && bIsNum) return an - bn
        if (aIsNum) return -1
        if (bIsNum) return 1
        return a.localeCompare(b, undefined, { numeric: true })
      })
      setRooms(merged)
    } catch (e) {
      // fallback to mapRooms or empty
      if (mapRooms && mapRooms.length) setRooms(mapRooms.map(r => String(r)))
      else setRooms([])
    }
  }

  // When user selects a property from the list, switch to it and leave tenant profile (tenant may not be in that property)
  const handlePropertySelect = (prop) => {
    setCurrentProperty(prop)
    setViewingTenantId(null)
  }

  const handlePropertyChange = async (propId) => {
    if (!propId) {
      setRooms([])
      setCurrentProperty(null)
      setViewingTenantId(null)
      return
    }
    const pid = propId
    const found = properties.find(p => String(p.id) === String(pid))
    if (found) {
      setCurrentProperty(found)
      setViewingTenantId(null)
    }
    try {
      const res = await authFetch(`/api/properties/${pid}/rooms/`)
      if (res && res.ok) {
        const data = await res.json()
        const roomList = Array.isArray(data) ? data.map(r => String(r)) : []
        roomList.sort((a, b) => {
          const an = Number(a); const bn = Number(b)
          const aIsNum = !Number.isNaN(an); const bIsNum = !Number.isNaN(bn)
          if (aIsNum && bIsNum) return an - bn
          if (aIsNum) return -1
          if (bIsNum) return 1
          return a.localeCompare(b, undefined, { numeric: true })
        })
        setRooms(roomList)
      } else {
        setRooms([])
      }
    } catch (e) {
      setRooms([])
    }
  }

  // persist sidebar open/collapsed to localStorage for this device
  useEffect(() => {
    try { localStorage.setItem('sidebarOpen', sidebarOpen ? 'true' : 'false') } catch (e) { }
  }, [sidebarOpen])

  // Mobile detection for responsive UI
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // persist selected property to localStorage
  useEffect(() => {
    try {
      if (currentProperty) {
        localStorage.setItem('currentProperty', JSON.stringify(currentProperty))
      } else {
        localStorage.removeItem('currentProperty')
      }
    } catch (e) { }
  }, [currentProperty])

  // persist current route to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('currentRoute', route)
    } catch (e) { }
  }, [route])

  useEffect(() => {
    let mounted = true
    async function loadMe() {
      setMeLoading(true)
      try {
        const res = await authFetch('/api/me/')
        if (!mounted) return
        if (res.ok) {
          const data = await res.json()
          setCurrentUser(data)
          // if not admin, load properties/users for the property list
          if (data.role !== 'admin') {
            try {
              const pRes = await authFetch('/api/properties/?include_archived=true')
              if (pRes.ok) {
                const pd = await pRes.json()
                if (mounted) {
                  setProperties(pd)
                  // Reconcile saved property with fresh data
                  const savedProp = localStorage.getItem('currentProperty')
                  if (savedProp) {
                    try {
                      const parsed = JSON.parse(savedProp)
                      const fresh = pd.find(p => p.id === parsed.id)
                      if (fresh) {
                        // Update with fresh data including floors
                        setCurrentProperty({
                          propertyName: fresh.name,
                          address: fresh.address,
                          id: fresh.id,
                          floors: fresh.floors || 1
                        })
                      }
                    } catch (e) { }
                  }
                }
              }
            } catch (e) {
              // ignore list load errors for now
            }
          }
        } else {
          // Unauthorized or refresh failed: clear tokens and return to login
          clearTokens()
          setCurrentUser(null)
          setLoggedIn(false)
        }
      } catch (e) {
        // Treat errors as unauthenticated
        clearTokens()
        setCurrentUser(null)
        setLoggedIn(false)
      } finally {
        if (mounted) setMeLoading(false)
      }
    }
    if (loggedIn) loadMe()
    return () => { mounted = false }
  }, [loggedIn])

  // When session expires (e.g. refresh token expired), show login again
  useEffect(() => {
    const onSessionExpired = () => setLoggedIn(false)
    window.addEventListener('auth:sessionExpired', onSessionExpired)
    return () => window.removeEventListener('auth:sessionExpired', onSessionExpired)
  }, [])

  if (!loggedIn) {
    return <Login onLogin={() => setLoggedIn(true)} />
  }

  if (loggedIn && meLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-gray-900">
        <div className="text-sm text-gray-600 dark:text-gray-400">Loading...</div>
      </div>
    )
  }

  const isAdminView = currentUser && (currentUser.role === 'admin' || currentUser.is_superuser || currentUser.is_staff)

  return (
    <div className="min-h-screen md:h-screen md:overflow-hidden overflow-x-hidden bg-white dark:bg-gray-900">
      <Sidebar
        currentUser={currentUser}
        UserName={currentUser?.username || ''}
        UserRole={currentUser?.role || ''}
        isOpen={sidebarOpen}
        onToggle={setSidebarOpen}
        onNavigate={setRoute}
        currentRoute={route}
      />

      <div className={`flex md:h-screen md:overflow-hidden transition-all duration-300 ${marginClass}`}>
        {isAdminView ? (
          <main className="flex-1 overflow-y-auto overflow-x-hidden bg-gray-100 dark:bg-gray-800 p-6">
            {route === '/activity-logs' ? (
              <AuditLogs />
            ) : route === '/active-sessions' ? (
              <ActiveSessions />
            ) : route === '/security-alerts' ? (
              <SecurityAlerts />
            ) : route === '/settings' ? (
              <Settings currentUser={currentUser} />
            ) : (
              <AdminPanel />
            )}
          </main>
        ) : (
          <>
            {/* PropertyList handles its own mobile overlay */}
            <PropertyList
              onSelect={handlePropertySelect}
              initialSelected={currentProperty}
              responsive
              properties={properties}
              currentUser={currentUser}
            />

            <main className={`flex-1 min-w-0 bg-gray-100 dark:bg-gray-800 ${route === '/reports' || route === '/dashboard' || route === '/activity-logs' || route === '/active-sessions' || route === '/security-alerts' || route === '/settings' ? 'md:overflow-y-auto' : 'md:overflow-y-auto p-4 md:p-6'}`}>
              {route !== '/add-tenant' && route !== '/activity-logs' && route !== '/reports' && route !== '/message' && route !== '/dashboard' && route !== '/active-sessions' && route !== '/security-alerts' && route !== '/settings' && !isMobile && (
                <>
                  <h1 className="text-xl font-semibold mb-1 text-gray-900 dark:text-white">{currentProperty?.propertyName || 'Select a property'}</h1>
                  {currentProperty?.address && (
                    <p className="text-sm text-gray-500 dark:text-gray-400">{currentProperty.address}</p>
                  )}
                  {currentProperty?.is_archived && (
                    <div className="mt-2 flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-amber-700 dark:text-amber-400 text-sm">
                      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                      </svg>
                      <span className="font-medium">This building is archived — view only</span>
                    </div>
                  )}
                </>
              )}
              <div className={route === '/reports' || route === '/message' || route === '/dashboard' ? 'md:h-full md:overflow-auto min-w-0 w-full' : route === '/activity-logs' || route === '/active-sessions' || route === '/security-alerts' || route === '/settings' ? 'min-w-0 w-full' : 'mt-4'}>
                {route === '/activity-logs' ? (
                  <AuditLogs />
                ) : route === '/active-sessions' ? (
                  <ActiveSessions />
                ) : route === '/security-alerts' ? (
                  <SecurityAlerts />
                ) : route === '/settings' ? (
                  <Settings currentUser={currentUser} />
                ) : route === '/dashboard' ? (
                  <Dashboard property={currentProperty} layoutsRefreshKey={layoutsRefreshKey} onViewTenantProfile={(tenantId) => { setTenantProfileReturnRoute('/dashboard'); setViewingTenantId(tenantId); setRoute('/home'); }} />
                ) : route === '/reports' ? (
                  <Reports property={currentProperty} onOpenAddTenant={openAddTenant} refreshKey={layoutsRefreshKey} />
                ) : route === '/message' ? (
                  <MassMessage property={currentProperty} layoutsRefreshKey={layoutsRefreshKey} />
                ) : route === '/add-tenant' ? (
                  <AddTenant
                    rooms={rooms}
                    properties={properties}
                    selectedPropertyId={currentProperty?.id}
                    defaultRoom={addTenantDefaultRoom || rooms[0] || ''}
                    propertyId={currentProperty?.id}
                    floor={addTenantFloor}
                    roomType={addTenantRoomType}
                    onPropertyChange={handlePropertyChange}
                    onCancel={() => setRoute('/home')}
                    onSaved={async (data) => {
                      // refresh properties and rooms for current property, then return to dashboard
                      try {
                        const pRes = await authFetch('/api/properties/?include_archived=true')
                        if (pRes && pRes.ok) {
                          const pd = await pRes.json()
                          setProperties(Array.isArray(pd) ? pd : [])
                        }
                      } catch (e) {
                        // ignore
                      }
                      try {
                        if (currentProperty && currentProperty.id) {
                          const rres = await authFetch(`/api/properties/${currentProperty.id}/rooms/`)
                          if (rres && rres.ok) {
                            const rd = await rres.json()
                            setRooms(Array.isArray(rd) ? rd : [])
                          }
                        }
                      } catch (e) {
                        // ignore
                      }
                      // signal OccupancyMap to refresh layouts (immediate map update)
                      setLayoutsRefreshKey(k => k + 1)
                      setRoute('/home')
                    }}
                  />
                ) : viewingTenantId ? (
                  <TenantProfile
                    tenantId={viewingTenantId}
                    onBack={(shouldRefresh) => {
                      setViewingTenantId(null)
                      if (shouldRefresh) {
                        setLayoutsRefreshKey(k => k + 1)
                      }
                      // Return to the route where tenant profile was opened from
                      if (tenantProfileReturnRoute && tenantProfileReturnRoute !== '/home') {
                        setRoute(tenantProfileReturnRoute)
                        setTenantProfileReturnRoute('/home')
                      }
                    }}
                    propertyName={currentProperty?.propertyName}
                  />
                ) : isMobile ? (
                  <MobileRoomList
                    property={currentProperty}
                    onOpenAddTenant={openAddTenant}
                    layoutsRefreshKey={layoutsRefreshKey}
                    onViewTenantProfile={(tenantId) => { setTenantProfileReturnRoute('/home'); setViewingTenantId(tenantId); }}
                    onPaymentSuccess={() => setLayoutsRefreshKey(k => k + 1)}
                  />
                ) : (
                  <OccupancyMap
                    property={currentProperty}
                    onOpenAddTenant={openAddTenant}
                    layoutsRefreshKey={layoutsRefreshKey}
                    onViewTenantProfile={(tenantId) => { setTenantProfileReturnRoute('/home'); setViewingTenantId(tenantId); }}
                    onPaymentSuccess={() => setLayoutsRefreshKey(k => k + 1)}
                  />
                )}
              </div>
            </main>
          </>
        )}
      </div>
    </div>
  )
}

export default App
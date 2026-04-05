import React, { useEffect, useState, useRef } from 'react'
import auth, { getAccess, authFetch } from '../auth'

export default function AdminPanel() {
  const [users, setUsers] = useState([])
  const [properties, setProperties] = useState([])
  const [form, setForm] = useState({ username: '', email: '', password: '', confirmPassword: '', role: 'owner' })
  const [building, setBuilding] = useState({ name: '', address: '', city: '', floors: 1, owners: [], managers: [] })
  const [loading, setLoading] = useState(false)
  const [editingProperty, setEditingProperty] = useState(null)
  const [editForm, setEditForm] = useState({ name: '', address: '', city: '', floors: 1, owners: [], managers: [] })
  const [currentUser, setCurrentUser] = useState(null)
  const [message, setMessage] = useState(null)
  const messageRef = useRef(null)
  const [activeTab, setActiveTab] = useState('accounts')

  useEffect(() => {
    fetchLists()
  }, [])

  async function fetchLists() {
    setLoading(true)
    try {
      const u = await authFetch('/api/me/')
      const usersRes = await authFetch('/api/admin/users/')
      const p = await authFetch('/api/admin/properties/?include_archived=true')
      // if not admin, redirect away
      if (u.ok) {
        const me = await u.json()
        setCurrentUser(me)
        if (me.role !== 'admin') {
          setMessage({ type: 'error', text: 'Access denied: admin only' })
          return
        }
      } else {
        setCurrentUser(null)
      }
      const ud = usersRes.ok ? await usersRes.json() : []
      const pd = p.ok ? await p.json() : []
      setUsers(ud)
      setProperties(pd)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function handleCreateUser(e) {
    e.preventDefault()
    if (!form.username.trim()) {
      setMessage({ type: 'error', text: 'Username is required' })
      return
    }
    if (form.password.length < 6) {
      setMessage({ type: 'error', text: 'Password must be at least 6 characters' })
      return
    }
    if (!/[a-zA-Z]/.test(form.password) || !/[0-9]/.test(form.password)) {
      setMessage({ type: 'error', text: 'Password must contain at least one letter and one number' })
      return
    }
    if (form.password !== form.confirmPassword) {
      setMessage({ type: 'error', text: 'Passwords do not match' })
      return
    }
    try {
      const res = await authFetch('/api/admin/users/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: form.username, email: form.email, password: form.password, role: form.role }),
      })
      if (!res.ok) {
        let txt = `Failed to create user (status ${res.status})`
        try {
          const d = await res.json()
          if (d.detail) { txt = d.detail }
          else {
            // DRF field validation errors: { field: ["error msg"] }
            const msgs = Object.entries(d).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join('; ')
            if (msgs) txt = msgs
          }
        } catch(e){}
        setMessage({ type: 'error', text: txt })
        return
      }
      setForm({ username: '', email: '', password: '', confirmPassword: '', role: 'owner' })
      setMessage({ type: 'success', text: 'User created' })
      await fetchLists()
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to create user' })
    }
  }

  async function handleCreateBuilding(e) {
    e.preventDefault()
    try {
      const payload = { name: building.name, address: building.address, city: building.city, floors: parseInt(building.floors) || 1 }
      if (building.owners && building.owners.length) payload.owners = building.owners.map(v => parseInt(v))
      if (building.managers && building.managers.length) payload.managers = building.managers.map(v => parseInt(v))
      const res = await authFetch('/api/admin/properties/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        let txt = `Failed to create building (status ${res.status})`
        try { const d = await res.json(); txt = d.detail || JSON.stringify(d) } catch(e){}
        setMessage({ type: 'error', text: txt })
        return
      }
      setBuilding({ name: '', address: '', city: '', floors: 1, owners: [], managers: [] })
      setMessage({ type: 'success', text: 'Building created' })
      await fetchLists()
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to create building' })
    }
  }

  async function saveProperty(propertyId) {
    try {
      const payload = { name: editForm.name, address: editForm.address, city: editForm.city, floors: parseInt(editForm.floors) || 1 }
      payload.owners = (editForm.owners || []).map(v => parseInt(v))
      payload.managers = (editForm.managers || []).map(v => parseInt(v))
      const res = await authFetch(`/api/properties/${propertyId}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        let txt = `Failed to save (status ${res.status})`
        try { const d = await res.json(); txt = d.detail || JSON.stringify(d) } catch(e){}
        setMessage({ type: 'error', text: txt })
        return
      }
      setEditingProperty(null)
      setMessage({ type: 'success', text: 'Property saved' })
      await fetchLists()
    } catch (e) {
      setMessage({ type: 'error', text: 'Failed to save' })
    }
  }

  async function archiveProperty(propertyId) {
    if (!confirm('Archive this building? It will be hidden but all data will be preserved.')) return
    try {
      const res = await authFetch(`/api/properties/${propertyId}/`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage({ type: 'error', text: data.detail || 'Failed to archive building' })
        return
      }
      setMessage({ type: 'success', text: data.detail || 'Building archived successfully' })
      await fetchLists()
    } catch (e) {
      setMessage({ type: 'error', text: 'Archive failed: ' + (e?.message || e) })
    }
  }

  async function restoreProperty(propertyId) {
    if (!confirm('Restore this building from archive?')) return
    try {
      const res = await authFetch(`/api/properties/${propertyId}/restore/`, { method: 'POST' })
      if (!res.ok) {
        let msg = `Failed to restore (status ${res.status})`
        try {
          const data = await res.json()
          msg = data.detail || data.error || JSON.stringify(data)
        } catch (e) {}
        setMessage({ type: 'error', text: msg })
        return
      }
      setMessage({ type: 'success', text: 'Building restored successfully' })
      await fetchLists()
    } catch (e) {
      setMessage({ type: 'error', text: 'Restore failed: ' + (e?.message || e) })
    }
  }

  async function deleteUser(userId) {
    if (!confirm('Delete user?')) return
    try {
      const res = await authFetch(`/api/users/${userId}/`, { method: 'DELETE' })
      if (!res.ok) {
        let msg = `Failed to delete (status ${res.status})`
        try {
          const data = await res.json()
          msg = data.detail || JSON.stringify(data)
        } catch (e) {}
        setMessage({ type: 'error', text: msg })
        return
      }
      setMessage({ type: 'success', text: 'User deleted' })
      await fetchLists()
    } catch (e) {
      setMessage({ type: 'error', text: 'Delete failed: ' + (e?.message || e) })
    }
  }

  function getOwnerNames(p) {
    return (p?.owners || []).map(id => (users.find(u => u.id === id) || {}).username).filter(Boolean).join(', ') || '—'
  }

  function getManagerNames(p) {
    return (p?.managers || []).map(id => (users.find(u => u.id === id) || {}).username).filter(Boolean).join(', ') || '—'
  }

  function toggleBuildingOwner(id) {
    setBuilding(b => {
      const exists = (b.owners || []).includes(id)
      // enforce single owner: toggle sets single-element array or clears
      return { ...b, owners: exists ? [] : [id] }
    })
  }

  function toggleBuildingManager(id) {
    setBuilding(b => {
      // prevent assigning the owner as a manager
      const ownerId = (b.owners && b.owners[0]) ? b.owners[0] : null
      if (ownerId && ownerId === id) return b
      const exists = (b.managers || []).includes(id)
      return { ...b, managers: exists ? b.managers.filter(x => x !== id) : [...(b.managers||[]), id] }
    })
  }

  function toggleEditOwner(id) {
    setEditForm(f => {
      const exists = (f.owners || []).includes(id)
      // enforce single owner
      return { ...f, owners: exists ? [] : [id] }
    })
  }

  function toggleEditManager(id) {
    setEditForm(f => {
      // prevent assigning the owner as a manager
      const ownerId = (f.owners && f.owners[0]) ? f.owners[0] : null
      if (ownerId && ownerId === id) return f
      const exists = (f.managers || []).includes(id)
      return { ...f, managers: exists ? f.managers.filter(x => x !== id) : [...(f.managers||[]), id] }
    })
  }

  function roleBadge(role) {
    const classes = {
      admin: 'bg-indigo-100 text-indigo-700',
      owner: 'bg-purple-100 text-purple-700',
      manager: 'bg-sky-100 text-sky-700',
    }
    return (
      <span className={`px-3 py-1 rounded-full text-sm font-medium ${classes[role] || 'bg-gray-100 text-gray-700'}`}>
        {role ? role.charAt(0).toUpperCase() + role.slice(1) : ''}
      </span>
    )
  }

  return (
    <div className="max-w-7xl mx-auto overflow-x-hidden">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold mb-2 text-gray-900 dark:text-white">Admin Panel</h2>
        <p className="text-gray-600 text-sm">Manage user accounts and buildings</p>
      </div>

      {/* Sticky message notification */}
      {message ? (
        <div className={`fixed top-4 right-4 z-50 max-w-md shadow-lg rounded-lg p-4 animate-slide-in ${message.type === 'error' ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <div className={`font-medium ${message.type === 'error' ? 'text-red-800' : 'text-green-800'}`}>
                {message.type === 'error' ? 'Error' : 'Success'}
              </div>
              <div className={`text-sm mt-1 ${message.type === 'error' ? 'text-red-700' : 'text-green-700'}`}>
                {message.text}
              </div>
            </div>
            <button onClick={() => setMessage(null)} className={`${message.type === 'error' ? 'text-red-400 hover:text-red-600' : 'text-green-400 hover:text-green-600'}`}>
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>
      ) : null}

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6 overflow-x-auto">
        <nav className="flex space-x-4 sm:space-x-8">
          <button
            onClick={() => setActiveTab('accounts')}
            className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'accounts'
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
              Accounts
              <span className="ml-1 bg-gray-100 text-gray-600 py-0.5 px-2 rounded-full text-xs">{users.length}</span>
            </div>
          </button>
          <button
            onClick={() => setActiveTab('buildings')}
            className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'buildings'
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              Buildings
              <span className="ml-1 bg-gray-100 text-gray-600 py-0.5 px-2 rounded-full text-xs">{properties.filter(p => !p.is_archived).length}</span>
            </div>
          </button>
          {properties.filter(p => p.is_archived).length > 0 && (
            <button
              onClick={() => setActiveTab('archived')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'archived'
                  ? 'border-amber-500 text-amber-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                </svg>
                Archived
                <span className="ml-1 bg-amber-100 text-amber-600 py-0.5 px-2 rounded-full text-xs">{properties.filter(p => p.is_archived).length}</span>
              </div>
            </button>
          )}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {activeTab === 'accounts' && (
          <>
            {/* Accounts List */}
            <div className="lg:col-span-2">
              <div className="bg-white rounded-lg shadow">
                <div className="p-6">
                  <h3 className="text-lg font-semibold mb-4">User Accounts</h3>
                  {loading ? (
                    <div className="text-center py-8 text-gray-500">Loading...</div>
                  ) : users.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">No accounts yet</div>
                  ) : (
                    <div className="space-y-3">
                      {users.map((u) => (
                        <div key={u.id} className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors overflow-hidden">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-2">
                                <div className="text-base font-medium text-gray-900">{u.username}</div>
                                {roleBadge(u.role)}
                                {u.is_superuser ? <span className="px-2 py-0.5 text-xs bg-yellow-100 text-yellow-800 rounded-full">Superuser</span> : null}
                              </div>
                              <div className="text-sm text-gray-500 mb-3 truncate">{u.email}</div>
                              <div className="text-xs text-gray-600">
                                <div className="font-medium mb-1">Assigned Properties:</div>
                                {properties.filter(p => (p.owners || []).includes(u.id) || (p.managers || []).includes(u.id)).length === 0 ? (
                                  <span className="text-gray-400">None</span>
                                ) : (
                                  <div className="flex flex-wrap gap-1">
                                    {properties.filter(p => (p.owners || []).includes(u.id) || (p.managers || []).includes(u.id)).map(p => (
                                      <span key={p.id} className="inline-block bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-xs">{p.name}</span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                            <button
                              onClick={() => deleteUser(u.id)}
                              className="text-white bg-red-600 hover:bg-red-700 p-2 rounded transition-colors flex-shrink-0"
                              title="Delete user"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Create Account Form */}
            <div className="lg:col-span-1">
              <div className="bg-white rounded-lg shadow sticky top-6">
                <div className="p-6">
                  <h3 className="text-lg font-semibold mb-4">Create New Account</h3>
                  <form onSubmit={handleCreateUser} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                      <input
                        value={form.username}
                        onChange={(e) => setForm({ ...form, username: e.target.value })}
                        placeholder="johndoe"
                        required
                        className="w-full border border-gray-300 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                      <input 
                        type="email"
                        value={form.email} 
                        onChange={(e) => setForm({ ...form, email: e.target.value })} 
                        placeholder="email@example.com" 
                        required
                        className="w-full border border-gray-300 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent" 
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                      <select 
                        value={form.role} 
                        onChange={(e) => setForm({ ...form, role: e.target.value })} 
                        className="w-full border border-gray-300 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      >
                        <option value="owner">Owner</option>
                        <option value="manager">Manager</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                      <input
                        value={form.password}
                        onChange={(e) => setForm({ ...form, password: e.target.value })}
                        placeholder="••••••••"
                        type="password"
                        required
                        className="w-full border border-gray-300 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      />
                      <p className="text-xs text-gray-500 mt-1">Min 6 characters, with at least one letter and one number</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
                      <input 
                        value={form.confirmPassword} 
                        onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} 
                        placeholder="••••••••" 
                        type="password" 
                        required
                        className="w-full border border-gray-300 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent" 
                      />
                    </div>
                    <button 
                      type="submit" 
                      className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-4 py-2.5 rounded-lg transition-colors"
                    >
                      Create Account
                    </button>
                  </form>
                </div>
              </div>
            </div>
          </>
        )}
        {activeTab === 'buildings' && (
          <>
            {/* Buildings List */}
            <div className="lg:col-span-2">
              <div className="bg-white rounded-lg shadow">
                <div className="p-6">
                  <h3 className="text-lg font-semibold mb-4">Buildings</h3>
                  {loading ? (
                    <div className="text-center py-8 text-gray-500">Loading...</div>
                  ) : properties.filter(p => !p.is_archived).length === 0 ? (
                    <div className="text-center py-8 text-gray-500">No buildings yet</div>
                  ) : (
                    <div className="space-y-3">
                      {properties.filter(p => !p.is_archived).map((p) => (
                        <div key={p.id} className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors">
                          {editingProperty && editingProperty.id === p.id ? (
                            <div>
                              <div className="space-y-3">
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">Building Name</label>
                                  <input 
                                    value={editForm.name} 
                                    onChange={(e)=>setEditForm({...editForm, name: e.target.value})} 
                                    className="w-full border border-gray-300 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                                  <input 
                                    value={editForm.address} 
                                    onChange={(e)=>setEditForm({...editForm, address: e.target.value})} 
                                    className="w-full border border-gray-300 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                                  <input
                                    value={editForm.city}
                                    onChange={(e)=>setEditForm({...editForm, city: e.target.value})}
                                    className="w-full border border-gray-300 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">Number of Floors</label>
                                  <input
                                    type="number"
                                    min="1"
                                    value={editForm.floors}
                                    onChange={(e)=>setEditForm({...editForm, floors: parseInt(e.target.value) || 1})}
                                    className="w-full border border-gray-300 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                  />
                                  <p className="text-xs text-gray-500 mt-1">This affects the occupancy map display</p>
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">Owner (select one)</label>
                                  <div className="w-full border border-gray-300 rounded-lg px-3 py-2 max-h-32 overflow-auto bg-gray-50">
                                    {users.filter(u => u.role === 'owner').map(u => (
                                      <label key={u.id} className="flex items-center gap-2 py-1.5 hover:bg-white px-2 rounded cursor-pointer">
                                        <input 
                                          type="radio" 
                                          name={`owner-edit-${p.id}`} 
                                          checked={(editForm.owners||[])[0] === String(u.id)} 
                                          onChange={() => toggleEditOwner(String(u.id))} 
                                          className="text-indigo-600"
                                        />
                                        <span className="text-sm">{u.username} — {u.email}</span>
                                      </label>
                                    ))}
                                  </div>
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">Managers (select multiple)</label>
                                  <div className="w-full border border-gray-300 rounded-lg px-3 py-2 max-h-32 overflow-auto bg-gray-50">
                                    {users.filter(u => u.role === 'manager' && u.id !== Number((editForm.owners||[])[0])).map(u => (
                                      <label key={u.id} className="flex items-center gap-2 py-1.5 hover:bg-white px-2 rounded cursor-pointer">
                                        <input 
                                          type="checkbox" 
                                          checked={(editForm.managers||[]).includes(String(u.id))} 
                                          onChange={() => toggleEditManager(String(u.id))} 
                                          className="text-indigo-600"
                                        />
                                        <span className="text-sm">{u.username} — {u.email}</span>
                                      </label>
                                    ))}
                                  </div>
                                </div>
                                <div className="flex gap-2 justify-end pt-2">
                                  <button 
                                    onClick={() => saveProperty(p.id)} 
                                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg transition-colors"
                                  >
                                    Save Changes
                                  </button>
                                  <button 
                                    onClick={()=>{ setEditingProperty(null) }} 
                                    className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1 flex-wrap">
                                  <div className="text-base font-medium text-gray-900">{p.name}</div>
                                  <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium">{p.floors || 1} floor{(p.floors || 1) !== 1 ? 's' : ''}</span>
                                </div>
                                <div className="text-sm text-gray-500 mb-3 break-words">{p.address}{p.city ? `, ${p.city}` : ''}</div>
                                <div className="grid grid-cols-2 gap-4 text-xs">
                                  <div>
                                    <div className="font-medium text-gray-700 mb-1">Owner:</div>
                                    <div className="text-gray-600">{getOwnerNames(p)}</div>
                                  </div>
                                  <div>
                                    <div className="font-medium text-gray-700 mb-1">Managers:</div>
                                    <div className="text-gray-600">{getManagerNames(p)}</div>
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <button
                                  onClick={() => {
                                    setEditingProperty(p);
                                    setEditForm({
                                      name: p.name || '',
                                      address: p.address || '',
                                      city: p.city || '',
                                      floors: p.floors || 1,
                                      owners: p.owners ? p.owners.map(String) : [],
                                      managers: p.managers ? p.managers.map(String) : []
                                    })
                                  }}
                                  className="text-sm text-indigo-600 hover:text-indigo-700 font-medium px-3 py-1.5 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => archiveProperty(p.id)}
                                  className="text-white bg-amber-600 hover:bg-amber-700 p-2 rounded-lg transition-colors"
                                  title="Archive building"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                                  </svg>
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Create Building Form */}
            <div className="lg:col-span-1">
              <div className="bg-white rounded-lg shadow sticky top-6">
                <div className="p-6">
                  <h3 className="text-lg font-semibold mb-4">Create New Building</h3>
                  <form onSubmit={handleCreateBuilding} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Building Name</label>
                      <input 
                        value={building.name} 
                        onChange={(e) => setBuilding({ ...building, name: e.target.value })} 
                        placeholder="Sunset Apartments" 
                        required
                        className="w-full border border-gray-300 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent" 
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                      <input 
                        value={building.address} 
                        onChange={(e) => setBuilding({ ...building, address: e.target.value })} 
                        placeholder="123 Main Street" 
                        required
                        className="w-full border border-gray-300 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent" 
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                      <input
                        value={building.city}
                        onChange={(e) => setBuilding({ ...building, city: e.target.value })}
                        placeholder="New York"
                        required
                        className="w-full border border-gray-300 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Number of Floors</label>
                      <input
                        type="number"
                        min="1"
                        value={building.floors}
                        onChange={(e) => setBuilding({ ...building, floors: parseInt(e.target.value) || 1 })}
                        placeholder="1"
                        className="w-full border border-gray-300 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      />
                      <p className="text-xs text-gray-500 mt-1">This affects the occupancy map display</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Owner (select one)</label>
                      <div className="w-full border border-gray-300 rounded-lg px-3 py-2 max-h-36 overflow-auto bg-gray-50">
                        {users.filter(u => u.role === 'owner').map(u => (
                          <label key={u.id} className="flex items-center gap-2 py-1.5 hover:bg-white px-2 rounded cursor-pointer">
                            <input 
                              type="radio" 
                              name="building-owner" 
                              checked={(building.owners||[])[0] === String(u.id)} 
                              onChange={() => toggleBuildingOwner(String(u.id))} 
                              className="text-green-600"
                            />
                            <span className="text-sm">{u.username} — {u.email}</span>
                          </label>
                        ))}
                        {users.filter(u => u.role === 'owner').length === 0 && (
                          <div className="text-sm text-gray-500 py-2">No owners available. Create an owner account first.</div>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Managers (optional)</label>
                      <div className="w-full border border-gray-300 rounded-lg px-3 py-2 max-h-36 overflow-auto bg-gray-50">
                        {users.filter(u => u.role === 'manager' && u.id !== Number((building.owners||[])[0])).map(u => (
                          <label key={u.id} className="flex items-center gap-2 py-1.5 hover:bg-white px-2 rounded cursor-pointer">
                            <input 
                              type="checkbox" 
                              checked={(building.managers||[]).includes(String(u.id))} 
                              onChange={() => toggleBuildingManager(String(u.id))} 
                              className="text-green-600"
                            />
                            <span className="text-sm">{u.username} — {u.email}</span>
                          </label>
                        ))}
                        {users.filter(u => u.role === 'manager' && u.id !== Number((building.owners||[])[0])).length === 0 && (
                          <div className="text-sm text-gray-500 py-2">No managers available</div>
                        )}
                      </div>
                    </div>
                    <button 
                      type="submit" 
                      className="w-full bg-green-600 hover:bg-green-700 text-white font-medium px-4 py-2.5 rounded-lg transition-colors"
                    >
                      Create Building
                    </button>
                  </form>
                </div>
              </div>
            </div>
          </>
        )}
        {activeTab === 'archived' && (
          <div className="lg:col-span-3">
            <div className="bg-white rounded-lg shadow">
              <div className="p-6">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                  </svg>
                  Archived Buildings
                </h3>
                {properties.filter(p => p.is_archived).length === 0 ? (
                  <div className="text-center py-8 text-gray-500">No archived buildings</div>
                ) : (
                  <div className="space-y-3">
                    {properties.filter(p => p.is_archived).map((p) => (
                      <div key={p.id} className="border border-dashed border-gray-300 rounded-lg p-4 bg-gray-50 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="p-2 bg-amber-100 text-amber-600 rounded-lg">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                            </svg>
                          </div>
                          <div>
                            <span className="font-medium text-gray-700">{p.name}</span>
                            <div className="text-sm text-gray-400">{p.address}{p.city ? `, ${p.city}` : ''}</div>
                            <div className="flex items-center gap-3 mt-1">
                              {p.archived_at && (
                                <span className="text-xs text-gray-400">
                                  Archived {new Date(p.archived_at).toLocaleDateString()}
                                </span>
                              )}
                              {p.owners_detail && p.owners_detail.length > 0 && (
                                <span className="text-xs text-gray-400">
                                  Owner: {p.owners_detail[0].full_name || p.owners_detail[0].username}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() => restoreProperty(p.id)}
                          className="text-sm text-indigo-600 hover:text-indigo-700 font-medium px-4 py-2 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors"
                        >
                          Restore
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

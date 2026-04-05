import React, { useEffect, useState } from 'react'
import { authFetch } from '../auth.js'

export default function ApplianceList({ tenantId, initialAppliances = null }) {
  const [appliances, setAppliances] = useState(initialAppliances || [])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState(false)  // Default to closed
  const [fetched, setFetched] = useState(!!initialAppliances)

  const fetchAppliances = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await authFetch('/api/appliances/')
      if (!res.ok) throw new Error('Failed to load appliances')
      const data = await res.json()
      // filter client-side for tenantId
      const list = Array.isArray(data) ? data.filter(a => String(a.tenant) === String(tenantId) || String(a.tenant_id || a.tenant) === String(tenantId)) : []
      setAppliances(list)
      setFetched(true)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  // Use initial appliances if provided, otherwise fetch when expanded
  useEffect(() => { 
    if (tenantId && expanded && !fetched && !initialAppliances) {
      fetchAppliances()
    }
  }, [tenantId, expanded, fetched, initialAppliances])

  // Update appliances when initialAppliances prop changes
  useEffect(() => {
    if (initialAppliances && Array.isArray(initialAppliances)) {
      setAppliances(initialAppliances)
      setFetched(true)
    }
  }, [initialAppliances])

  const handleDelete = async (id) => {
    if (!confirm('Delete this appliance?')) return
    try {
      const res = await authFetch(`/api/appliances/${id}/`, { method: 'DELETE' })
      if (res.status !== 204 && !res.ok) throw new Error('Delete failed')
      await fetchAppliances()
    } catch (e) {
      setError(e.message || String(e))
    }
  }

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <button 
          onClick={() => setExpanded(e => !e)} 
          className="flex items-center gap-1 text-base font-semibold text-gray-900 dark:text-white hover:text-blue-600"
        >
          <span>{expanded ? '▼' : '▶'}</span>
          <span>Appliances</span>
          {appliances.length > 0 && (
            <span className="ml-1 px-2 py-0.5 text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded-full">
              {appliances.length}
            </span>
          )}
        </button>
      </div>
      {expanded && (
        <>
          {error && <div className="text-sm text-red-600 mb-2">{error}</div>}
          {loading ? (
            <div className="text-sm text-gray-500">Loading...</div>
          ) : (
            <div className="space-y-2">
              {appliances.length === 0 && <div className="text-sm text-gray-500">No appliances registered.</div>}
              {appliances.map((a, idx) => (
                <div key={a.appliance_id || a.id || idx} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-900 rounded-lg border">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center flex-shrink-0">
                      <svg className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                      </svg>
                    </div>
                    <div>
                      <div className="font-medium text-sm text-gray-900 dark:text-white">{a.name}</div>
                      <div className="text-xs text-blue-600 dark:text-blue-400">+₱{Number(a.surcharge_amount || a.surcharge || 0).toLocaleString()}/mo</div>
                    </div>
                  </div>
                  {(a.appliance_id || a.id) && (
                    <button 
                      onClick={() => handleDelete(a.appliance_id || a.id)} 
                      className="p-1 text-gray-400 hover:text-red-500 rounded"
                      title="Delete appliance"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
              {appliances.length > 0 && (
                <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400">Total Surcharge:</span>
                    <span className="font-semibold text-blue-600 dark:text-blue-400">
                      +₱{appliances.reduce((sum, a) => sum + (Number(a.surcharge_amount || a.surcharge || 0)), 0).toLocaleString()}/mo
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

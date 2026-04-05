import React, { useState } from 'react'

/**
 * Reusable Appliance Input Component
 * Allows adding multiple appliances with name and surcharge amount
 * 
 * @param {Array} appliances - Array of {name: string, surcharge: number}
 * @param {Function} onChange - Callback when appliances change
 * @param {number} defaultSurcharge - Default surcharge amount (default: 100)
 * @param {boolean} showTotal - Whether to show the total surcharge
 * @param {string} className - Additional CSS classes
 */
export default function ApplianceInput({ 
  appliances = [], 
  onChange, 
  defaultSurcharge = 100,
  showTotal = true,
  className = ''
}) {
  const [newName, setNewName] = useState('')
  const [newSurcharge, setNewSurcharge] = useState(defaultSurcharge)

  const handleAdd = () => {
    if (!newName.trim()) return
    
    const newAppliance = {
      name: newName.trim(),
      surcharge: Number(newSurcharge) || defaultSurcharge
    }
    
    const updated = [...appliances, newAppliance]
    if (typeof onChange === 'function') {
      onChange(updated)
    }
    
    setNewName('')
    setNewSurcharge(defaultSurcharge)
  }

  const handleRemove = (index) => {
    const updated = appliances.filter((_, i) => i !== index)
    if (typeof onChange === 'function') {
      onChange(updated)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAdd()
    }
  }

  const totalSurcharge = appliances.reduce((sum, a) => sum + (Number(a.surcharge) || 0), 0)

  return (
    <div className={className}>
      {/* Add New Appliance Row */}
      <div className="flex gap-2 mb-3">
        <div className="flex-1">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Appliance name (e.g., Air Conditioner)"
            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder:text-gray-500 dark:placeholder:text-gray-400"
          />
        </div>
        <div className="w-28">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400 text-sm">₱</span>
            <input
              type="number"
              value={newSurcharge}
              onChange={(e) => setNewSurcharge(e.target.value)}
              onKeyDown={handleKeyDown}
              min="0"
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg pl-7 pr-2 py-2 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder:text-gray-500 dark:placeholder:text-gray-400"
              placeholder="100"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={handleAdd}
          disabled={!newName.trim()}
          className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {/* List of Added Appliances */}
      {appliances.length > 0 && (
        <div className="space-y-2">
          {appliances.map((appliance, index) => (
            <div 
              key={index} 
              className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                  <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                  </svg>
                </div>
                <div>
                  <div className="font-medium text-gray-900 dark:text-white text-sm">{appliance.name}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">+₱{Number(appliance.surcharge).toLocaleString()}/month</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleRemove(index)}
                className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                title="Remove appliance"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
          
          {/* Total Surcharge */}
          {showTotal && appliances.length > 0 && (
            <div className="flex justify-between items-center pt-2 border-t border-gray-200 dark:border-gray-700 mt-2">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Total Appliance Surcharge:</span>
              <span className="text-sm font-bold text-blue-600 dark:text-blue-400">+₱{totalSurcharge.toLocaleString()}/month</span>
            </div>
          )}
        </div>
      )}

      {appliances.length === 0 && (
        <p className="text-xs text-gray-500 mt-1">Add appliances that incur additional monthly charges</p>
      )}
    </div>
  )
}

/**
 * Helper function to calculate total appliance surcharge
 */
export function calculateApplianceSurcharge(appliances) {
  if (!Array.isArray(appliances)) return 0
  return appliances.reduce((sum, a) => sum + (Number(a.surcharge) || 0), 0)
}

/**
 * Helper function to format appliances for API submission
 */
export function formatAppliancesForAPI(appliances) {
  if (!Array.isArray(appliances)) return []
  return appliances.map(a => ({
    name: a.name,
    surcharge_amount: Number(a.surcharge) || 0,
    notes: ''
  }))
}

import React, { useState } from 'react'

export default function OccupantsList({ initialOccupants = [] }) {
  const [expanded, setExpanded] = useState(false)  // Default to closed
  const occupants = initialOccupants || []

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={() => setExpanded(e => !e)}
          className="flex items-center gap-1 text-base font-semibold text-gray-900 dark:text-white hover:text-blue-600"
        >
          <span>{expanded ? '▼' : '▶'}</span>
          <span>Other Occupants</span>
          {occupants.length > 0 && (
            <span className="ml-1 px-2 py-0.5 text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded-full">
              {occupants.length}
            </span>
          )}
        </button>
      </div>
      {expanded && (
        <div className="space-y-2">
          {occupants.length === 0 && <div className="text-sm text-gray-500 dark:text-gray-400">No other occupants registered.</div>}
          {occupants.map((occupant, idx) => (
            <div key={idx} className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
              <div className="w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center flex-shrink-0">
                <svg className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="font-medium text-sm text-gray-900 dark:text-white">{occupant.full_name || 'N/A'}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">{occupant.relationship || 'N/A'}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

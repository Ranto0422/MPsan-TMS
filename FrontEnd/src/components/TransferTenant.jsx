import React, { useState, useEffect } from 'react'
import { authFetch } from '../auth'

export default function TransferTenant({ tenant, currentRoom, currentFloor, propertyId, allBoxes, onClose, onSuccess, formatRoomDisplay }) {
  const [roomsByFloor, setRoomsByFloor] = useState({})
  const [selectedRoom, setSelectedRoom] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Helper to format room display name
  const formatRoom = (box) => {
    if (typeof formatRoomDisplay === 'function') {
      return formatRoomDisplay(box)
    }
    // Fallback formatting
    const type = box.type || 'room'
    const number = box.number || ''
    const section = box.section || ''
    if (type === 'commercial') return `C${number}`
    if (section) return `${section.charAt(0).toUpperCase()}${number}`
    return number
  }

  useEffect(() => {
    // Extract available rooms from allBoxes, grouped by floor
    // Debug: log what we receive
    console.log('TransferTenant allBoxes:', allBoxes?.length, 'currentRoom:', currentRoom, 'currentFloor:', currentFloor)

    if (allBoxes && Array.isArray(allBoxes)) {
      const grouped = {}

      allBoxes
        .filter(room => {
          // Only show available rooms
          if (room.status !== 'available') return false
          // Exclude the current room using formatted name comparison
          const roomFormatted = formatRoom(room)
          return roomFormatted !== currentRoom
        })
        .forEach(room => {
          const floor = room.floor || 1
          if (!grouped[floor]) {
            grouped[floor] = []
          }
          grouped[floor].push({
            number: room.number,
            formatted: formatRoom(room),
            section: room.section,
            type: room.type,
            floor: floor
          })
        })

      // Sort rooms within each floor
      Object.keys(grouped).forEach(floor => {
        grouped[floor].sort((a, b) => {
          // Sort by section prefix first, then by number
          const prefixA = a.formatted.match(/^[A-Z]+/)?.[0] || ''
          const prefixB = b.formatted.match(/^[A-Z]+/)?.[0] || ''
          if (prefixA !== prefixB) return prefixA.localeCompare(prefixB)
          const numA = parseInt(a.number) || 0
          const numB = parseInt(b.number) || 0
          return numA - numB
        })
      })

      console.log('TransferTenant grouped rooms:', grouped)
      setRoomsByFloor(grouped)
    }
  }, [allBoxes, currentRoom, currentFloor])

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!selectedRoom) {
      setError('Please select a room')
      return
    }

    setLoading(true)
    setError('')

    try {
      const tenantId = tenant.tenant_id || tenant.id

      const response = await authFetch(`/api/tenants/${tenantId}/transfer/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          property_id: propertyId,
          from_room: currentRoom,
          to_room: selectedRoom
        })
      })

      if (response.ok) {
        if (typeof onSuccess === 'function') {
          onSuccess()
        }
        onClose()
      } else {
        const data = await response.json()
        setError(data.error || 'Failed to transfer tenant')
      }
    } catch (err) {
      console.error('Transfer error:', err)
      setError('An error occurred while transferring tenant')
    } finally {
      setLoading(false)
    }
  }

  const floors = Object.keys(roomsByFloor).sort((a, b) => Number(a) - Number(b))
  const totalRooms = floors.reduce((sum, f) => sum + roomsByFloor[f].length, 0)

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-[80] p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 flex-1 overflow-y-auto">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
            Transfer Tenant
          </h2>

          <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900 rounded-lg">
            <p className="text-sm text-gray-700 dark:text-gray-300">
              <strong>{tenant.full_name}</strong>
            </p>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
              Current Room: {currentRoom}
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Select a room to transfer to:
              </label>
              {totalRooms > 0 ? (
                <div className="space-y-3">
                  {floors.map(floor => (
                    <div key={floor} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                      <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2">
                        🏢 Floor {floor}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {roomsByFloor[floor].map(room => (
                          <button
                            key={`btn-${floor}-${room.number}`}
                            type="button"
                            onClick={() => setSelectedRoom(room.formatted)}
                            className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${selectedRoom === room.formatted
                                ? 'bg-green-500 text-white border-green-500'
                                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-green-100 dark:hover:bg-green-900'
                              }`}
                          >
                            {room.formatted}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  No available rooms found
                </p>
              )}
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                disabled={loading}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={loading || totalRooms === 0}
              >
                {loading ? 'Transferring...' : 'Transfer'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

import { useState, useEffect } from 'react'
import { authFetch, getAccess, buildWsUrl } from '../auth.js'
import { isBoxOverdue } from './paymentUtils.js'
import RoomSidebar from './RoomSidebar.jsx'
import PaymentConfirmation from './PaymentConfirmation.jsx'
import EditTenant from './EditTenant.jsx'
import TransferTenant from './TransferTenant.jsx'

// Helper function to format room display name
const formatRoomDisplay = (box) => {
  if (!box) return ''
  const type = box.type || 'room'
  const number = box.number || ''
  const section = box.section || ''

  if (type === 'commercial') {
    return `C${number}`
  }

  if (section) {
    const sectionPrefix = section.charAt(0).toUpperCase()
    return `${sectionPrefix}${number}`
  }

  return number
}

export default function MobileRoomList({ property, onOpenAddTenant, layoutsRefreshKey, onViewTenantProfile, onPaymentSuccess }) {
  const [rooms, setRooms] = useState([])
  const [allRooms, setAllRooms] = useState([])
  const [loading, setLoading] = useState(true)
  const [floor, setFloor] = useState(1)
  const [selectedRoom, setSelectedRoom] = useState(null)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [paymentModalData, setPaymentModalData] = useState(null)
  const [pendingEditBox, setPendingEditBox] = useState(null)
  const [pendingTransferBox, setPendingTransferBox] = useState(null)
  const [showAddRoom, setShowAddRoom] = useState(false)
  const [addRoomForm, setAddRoomForm] = useState({ number: '', type: 'room', section: '' })
  const [addRoomError, setAddRoomError] = useState('')
  const [addRoomSaving, setAddRoomSaving] = useState(false)
  const [addRoomFloor, setAddRoomFloor] = useState(1)
  const [addRoomDuplicate, setAddRoomDuplicate] = useState(false)

  const handleAddRoom = async (force = false) => {
    if (!addRoomForm.number.trim()) { setAddRoomError('Room number is required'); return }
    setAddRoomSaving(true)
    setAddRoomError('')
    setAddRoomDuplicate(false)
    try {
      const res = await authFetch(`/api/properties/${property.id}/layouts/`)
      if (!res.ok) throw new Error('Failed to fetch layouts')
      const data = await res.json()
      const layouts = data.layouts || {}
      const variant = 'default'
      const existing = layouts[variant] || []

      // Duplicate check: same number + section + floor
      if (!force) {
        const targetSection = addRoomForm.section.trim().toLowerCase()
        const targetNumber = addRoomForm.number.trim().toLowerCase()
        const duplicate = existing.find(b => {
          const bFloor = b.floor || 1
          const bSection = (b.section || '').toLowerCase()
          const bNumber = (b.number || '').toLowerCase()
          return bFloor === addRoomFloor && bSection === targetSection && bNumber === targetNumber
        })
        if (duplicate) {
          setAddRoomDuplicate(true)
          setAddRoomSaving(false)
          return
        }
      }

      // Auto-position: sequential row-based placement (room=1x2 grid, commercial=2x2 grid)
      const GRID = 25
      const BOX_W = GRID * 1   // room width: 25px
      const BOX_H = GRID * 2   // room height: 50px
      const COMM_W = GRID * 2  // commercial width: 50px
      const w = addRoomForm.type === 'commercial' ? COMM_W : BOX_W
      const h = BOX_H
      const STEP_X = GRID * 2   // 50px horizontal step (fits room + gap)
      const STEP_Y = GRID * 3   // 75px vertical step (fits room + gap)
      const COLS = 8
      const currentFloorBoxes = existing.filter(b => (b.floor || 1) === addRoomFloor)
      const idx = currentFloorBoxes.length
      const x = (idx % COLS) * STEP_X
      const y = Math.floor(idx / COLS) * STEP_Y

      const newBox = {
        id: Date.now(),
        x, y, w, h,
        type: addRoomForm.type,
        number: addRoomForm.number.trim(),
        section: addRoomForm.section.trim() || undefined,
        status: 'available',
        floor: addRoomFloor,
        rotation: 0,
        occupancy: 0,
        capacity: 1,
      }
      const updatedVariant = [...existing, newBox]
      const saveRes = await authFetch(`/api/properties/${property.id}/layouts/`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layouts: { [variant]: updatedVariant } }),
      })
      if (!saveRes.ok) throw new Error('Failed to save')
      setShowAddRoom(false)
      setAddRoomForm({ number: '', type: 'room', section: '' })
      setAddRoomDuplicate(false)
      if (typeof onPaymentSuccess === 'function') onPaymentSuccess()
    } catch (err) {
      setAddRoomError(err.message || 'Failed to add room')
    } finally {
      setAddRoomSaving(false)
    }
  }

  // Fetch layouts when property changes
  useEffect(() => {
    if (!property?.id) {
      setRooms([])
      setAllRooms([])
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)

    const fetchLayouts = async () => {
      try {
        const res = await authFetch(`/api/properties/${property.id}/layouts/`)
        if (!res.ok || cancelled) return

        const data = await res.json()
        const layouts = data.layouts || {}
        const variant = 'default'
        const allBoxes = layouts[variant] || []

        if (cancelled) return

        setAllRooms(allBoxes)
        // Filter by current floor
        const floorRooms = allBoxes.filter(b => (b.floor || 1) === floor)
        setRooms(floorRooms)
      } catch (e) {
        console.error('Error fetching layouts:', e)
        setRooms([])
        setAllRooms([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchLayouts()
    return () => { cancelled = true }
  }, [property?.id, layoutsRefreshKey])

  // Update displayed rooms when floor changes
  useEffect(() => {
    const floorRooms = allRooms.filter(b => (b.floor || 1) === floor)
    setRooms(floorRooms)
  }, [floor, allRooms])

  // WebSocket for real-time updates
  useEffect(() => {
    if (!property?.id) return

    const token = getAccess()
    const qs = token ? `?token=${encodeURIComponent(token)}` : ''
    const url = buildWsUrl(`/ws/properties/${property.id}/${qs}`)

    let ws
    const connectTimer = setTimeout(() => {
      try {
        ws = new WebSocket(url)

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data)
            if (msg.type === 'layout_update' && msg.layouts) {
              const variant = 'default'
              const allBoxes = msg.layouts[variant] || []
              setAllRooms(allBoxes)
            }
          } catch (e) {
            console.warn('WebSocket message parse error:', e)
          }
        }

        ws.onerror = (e) => console.warn('WebSocket error:', e)
      } catch (e) {
        console.warn('WebSocket connection failed:', e)
      }
    }, 100)

    return () => {
      clearTimeout(connectTimer)
      if (ws) {
        ws.close()
      }
    }
  }, [property?.id])

  // Get unique floors from all rooms
  const floors = [...new Set(allRooms.map(r => r.floor || 1))].sort((a, b) => a - b)

  // Sort and group rooms by section
  const groupedRooms = rooms.reduce((acc, room) => {
    const section = room.section || 'Unsectioned'
    if (!acc[section]) acc[section] = []
    acc[section].push(room)
    return acc
  }, {})

  // Sort sections and rooms within sections
  const sections = Object.keys(groupedRooms).sort()
  sections.forEach(s => {
    groupedRooms[s].sort((a, b) => (parseInt(a.number) || 0) - (parseInt(b.number) || 0))
  })

  // State to track expanded sections
  const [expandedSections, setExpandedSections] = useState({})

  // Toggle section expansion
  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }))
  }

  // Effect to expand all sections by default when rooms change
  useEffect(() => {
    const allExpanded = {}
    sections.forEach(s => allExpanded[s] = true)
    setExpandedSections(allExpanded)
  }, [rooms.length])

  // Handler for opening payment modal from RoomSidebar
  const handleOpenPaymentModal = (data) => {
    setPaymentModalData(data)
    setShowPaymentModal(true)
    setSelectedRoom(null)
  }

  // Handler for payment success
  const handlePaymentSuccess = () => {
    // Don't close modal — PaymentConfirmation will show the send-confirmation step first
    if (typeof onPaymentSuccess === 'function') {
      onPaymentSuccess()
    }
  }

  // Handler for receivable received (trigger refresh)
  const handleReceivableReceived = () => {
    if (typeof onPaymentSuccess === 'function') {
      onPaymentSuccess()
    }
  }

  if (!property) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] p-6 text-center">
        <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mb-4">
          <svg className="w-8 h-8 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          Select a Property
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Choose a property from the list to view rooms.
        </p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-3 border-blue-600 border-t-transparent mx-auto mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading rooms...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 pb-32">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {property.propertyName || property.name}
          </h2>
          {property.address && (
            <p className="text-sm text-gray-500 dark:text-gray-400">{property.address}</p>
          )}
        </div>

        {!property.is_archived && (
          <button
            onClick={() => { setShowAddRoom(true); setAddRoomError(''); setAddRoomDuplicate(false); setAddRoomFloor(floor) }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 dark:bg-blue-500 text-white rounded-lg text-xs font-bold shadow-md active:scale-95 transition-all"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" />
            </svg>
            Add Room
          </button>
        )}
      </div>
      {property.is_archived && (
        <div className="mt-2 flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-amber-700 dark:text-amber-400 text-sm">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
          </svg>
          <span className="font-medium">Archived — view only</span>
        </div>
      )}

      {/* Floor Selector */}
      {
        floors.length > 1 && (
          <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
            {floors.map(f => (
              <button
                key={f}
                onClick={() => setFloor(f)}
                className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${floor === f
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-100 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
              >
                Floor {f}
              </button>
            ))}
          </div>
        )
      }

      {/* Stats Summary */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        <div className="bg-green-100 dark:bg-green-700/60 rounded-lg p-3 text-center">
          <div className="text-xl font-bold text-green-700 dark:text-green-100">
            {rooms.filter(r => r.status === 'occupied' && !isBoxOverdue(r)).length}
          </div>
          <div className="text-xs text-green-600 dark:text-green-500">Occupied</div>
        </div>
        <div className="bg-gray-100 dark:bg-gray-600/70 rounded-lg p-3 text-center">
          <div className="text-xl font-bold text-gray-700 dark:text-gray-100">
            {rooms.filter(r => r.status === 'available').length}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">Vacant</div>
        </div>
        <div className="bg-yellow-100 dark:bg-yellow-700/60 rounded-lg p-3 text-center">
          <div className="text-xl font-bold text-yellow-700 dark:text-yellow-100">
            {rooms.filter(r => r.status === 'maintenance').length}
          </div>
          <div className="text-xs text-yellow-600 dark:text-yellow-500">Maintenance</div>
        </div>
        <div className="bg-red-100 dark:bg-red-700/60 rounded-lg p-3 text-center">
          <div className="text-xl font-bold text-red-700 dark:text-red-100">
            {rooms.filter(r => isBoxOverdue(r)).length}
          </div>
          <div className="text-xs text-red-600 dark:text-red-500">Overdue</div>
        </div>
      </div>

      {/* Redesigned Room List (Sectional List View) */}
      {
        rooms.length === 0 ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-700">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
            <p className="font-medium">No rooms on this floor</p>
          </div>
        ) : (
          <div className="space-y-6">
            {sections.map(sectionName => {
              const sectionRooms = groupedRooms[sectionName]
              const isExpanded = expandedSections[sectionName] !== false
              const occupiedCount = sectionRooms.filter(r => r.status === 'occupied').length

              return (
                <div key={sectionName} className="space-y-3">
                  {/* Section Header */}
                  <button
                    onClick={() => toggleSection(sectionName)}
                    className="w-full flex items-center justify-between px-1 group"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-6 bg-blue-600 dark:bg-blue-500 rounded-full" />
                      <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-tight">
                        Section {sectionName}
                      </h3>
                      <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">
                        {occupiedCount}/{sectionRooms.length} Occupied
                      </span>
                    </div>
                    <svg
                      className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                      fill="none" stroke="currentColor" viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {/* Section Rooms List */}
                  {isExpanded && (
                    <div className="space-y-2.5">
                      {sectionRooms.map(room => {
                        const isOccupied = room.status === 'occupied'
                        const isMaintenance = room.status === 'maintenance'
                        const isOverdue = isBoxOverdue(room)

                        const statusColor = isOverdue
                          ? 'bg-red-500'
                          : isOccupied
                            ? 'bg-green-500'
                            : isMaintenance
                              ? 'bg-yellow-500'
                              : 'bg-gray-300'

                        const bgColor = isOverdue
                          ? 'bg-red-50 dark:bg-red-900/10'
                          : isOccupied
                            ? 'bg-green-50 dark:bg-green-900/10'
                            : isMaintenance
                              ? 'bg-yellow-50 dark:bg-yellow-900/10'
                              : 'bg-white dark:bg-gray-800'

                        const borderColor = isOverdue
                          ? 'border-red-100 dark:border-red-900/20'
                          : isOccupied
                            ? 'border-green-100 dark:border-green-900/20'
                            : isMaintenance
                              ? 'border-yellow-100 dark:border-yellow-900/20'
                              : 'border-gray-100 dark:border-gray-700'

                        return (
                          <button
                            key={room.id || `${room.section}-${room.number}`}
                            onClick={() => setSelectedRoom(room)}
                            className={`w-full flex items-stretch border rounded-xl overflow-hidden transition-all active:scale-[0.98] shadow-sm ${bgColor} ${borderColor} text-left`}
                          >
                            {/* Status Accent Bar */}
                            <div className={`w-1.5 flex-shrink-0 ${statusColor}`} />

                            <div className="flex-1 p-3 flex items-center gap-3">
                              {/* Room Number Circle */}
                              <div className="w-10 h-10 rounded-full bg-white dark:bg-gray-700 border border-gray-100 dark:border-gray-600 flex items-center justify-center flex-shrink-0 shadow-sm">
                                <span className="text-sm font-black text-gray-900 dark:text-white">
                                  {formatRoomDisplay(room)}
                                </span>
                              </div>

                              {/* Room Info */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between mb-0.5">
                                  <span className={`text-sm font-bold truncate ${isOccupied ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}>
                                    {isOccupied && room.tenant
                                      ? room.tenant.full_name || room.tenant.name
                                      : isMaintenance
                                        ? 'Maintenance'
                                        : 'Available'
                                    }
                                  </span>
                                  {isOccupied && room.payment && (
                                    <span className="text-[10px] font-black text-gray-700 dark:text-gray-300 bg-gray-100/80 dark:bg-gray-700/80 px-1.5 py-0.5 rounded">
                                      ₱{Number(room.payment).toLocaleString()}
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-2">
                                  <span className={`text-[10px] font-black uppercase tracking-widest ${isOverdue ? 'text-red-600 dark:text-red-400' :
                                    isOccupied ? 'text-green-600 dark:text-green-400' :
                                      isMaintenance ? 'text-yellow-600 dark:text-yellow-400' :
                                        'text-gray-400 dark:text-gray-500'
                                    }`}>
                                    {isOverdue ? 'Payment Overdue' : room.status}
                                  </span>
                                  {isOccupied && room.tenant?.payment_day && (
                                    <span className="text-[10px] text-gray-400 dark:text-gray-500">• Due Day: {room.tenant.payment_day}</span>
                                  )}
                                </div>
                              </div>

                              {/* Arrow Indicator */}
                              <svg className="w-4 h-4 text-gray-300 flex-shrink-0 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" />
                              </svg>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      }

      {/* RoomSidebar */}
      {
        selectedRoom && (
          <RoomSidebar
            box={{ ...selectedRoom, propertyId: property.id }}
            allBoxes={allRooms.map(r => ({ ...r, propertyId: property.id }))}
            onClose={() => setSelectedRoom(null)}
            onAddTenant={(roomNumber) => {
              setSelectedRoom(null)
              if (typeof onOpenAddTenant === 'function') {
                onOpenAddTenant(roomNumber, rooms.map(r => formatRoomDisplay(r)), floor)
              }
            }}
            formatRoomDisplay={formatRoomDisplay}
            onViewTenantProfile={(tenantId) => {
              setSelectedRoom(null)
              if (typeof onViewTenantProfile === 'function') {
                onViewTenantProfile(tenantId)
              }
            }}
            onPaymentSuccess={() => {
              if (typeof onPaymentSuccess === 'function') {
                onPaymentSuccess()
              }
            }}
            onOpenPaymentModal={handleOpenPaymentModal}
            onOpenEditModal={({ box }) => {
              setPendingEditBox({ box: { ...box, propertyId: property.id } })
              setSelectedRoom(null)
            }}
            onOpenTransferModal={({ box }) => {
              setPendingTransferBox({ box: { ...box, propertyId: property.id } })
              setSelectedRoom(null)
            }}
            onReceivableReceived={handleReceivableReceived}
            isArchived={!!property.is_archived}
          />
        )
      }

      {/* Payment Confirmation Modal */}
      {
        showPaymentModal && paymentModalData && (
          <PaymentConfirmation
            tenant={paymentModalData.box?.tenant}
            roomNumber={formatRoomDisplay(paymentModalData.box)}
            propertyId={property.id}
            defaultAmount={paymentModalData.box?.payment}
            onClose={() => {
              setShowPaymentModal(false)
              setPaymentModalData(null)
            }}
            onSuccess={handlePaymentSuccess}
            batchRooms={(() => {
              const box = paymentModalData.box
              const allBoxes = paymentModalData.allBoxes
              if (!box?.tenant || !allBoxes || !Array.isArray(allBoxes)) return undefined
              const tid = box.tenant.tenant_id ?? box.tenant.id
              const sameTenant = allBoxes.filter(b =>
                b.tenant && (String(b.tenant.tenant_id) === String(tid) || String(b.tenant.id) === String(tid))
              )
              if (sameTenant.length <= 1) return undefined
              return sameTenant.map(b => ({
                propertyId: property.id,
                roomNumber: formatRoomDisplay(b),
                defaultAmount: b.payment
              }))
            })()}
          />
        )
      }

      {/* Edit Tenant Modal */}
      {
        pendingEditBox && pendingEditBox.box?.tenant && (() => {
          const box = pendingEditBox.box
          const applianceSurchargeTotal = (box.appliances || []).reduce((sum, a) => sum + (Number(a.surcharge_amount || a.surcharge || 0)), 0)
          const basePayment = (box.payment || 0) - applianceSurchargeTotal

          return (
            <EditTenant
              tenant={{
                ...box.tenant,
                payment: basePayment,
                monthly_rent: basePayment,
                payment_day: box.preferred_payment_day || box.tenant?.payment_day,
                preferred_payment_day: box.preferred_payment_day || box.tenant?.preferred_payment_day,
                other_occupants: box.tenant?.other_occupants || []
              }}
              appliances={box.appliances || []}
              propertyId={box.propertyId}
              roomNumber={box.number}
              roomSection={box.section}
              roomType={box.type}
              onClose={() => setPendingEditBox(null)}
              onSuccess={() => {
                setPendingEditBox(null)
                if (typeof onPaymentSuccess === 'function') onPaymentSuccess()
              }}
            />
          )
        })()
      }

      {/* Transfer Tenant Modal */}
      {
        pendingTransferBox && pendingTransferBox.box?.tenant && (
          <TransferTenant
            tenant={pendingTransferBox.box.tenant}
            allBoxes={allRooms}
            propertyId={pendingTransferBox.box.propertyId}
            onClose={() => setPendingTransferBox(null)}
            onSuccess={() => {
              setPendingTransferBox(null)
              if (typeof onPaymentSuccess === 'function') onPaymentSuccess()
            }}
          />
        )
      }


      {/* Add Room Modal */}
      {
        showAddRoom && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowAddRoom(false)}>
            <div className="w-full max-w-sm mx-4 bg-white dark:bg-gray-800 rounded-2xl p-5 space-y-4 shadow-2xl" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">Add Room / Commercial</h3>

              {addRoomError && (
                <p className="text-sm text-red-600 dark:text-red-400">{addRoomError}</p>
              )}

              {/* Room Type */}
              <div className="flex gap-2">
                {['room', 'commercial'].map(t => (
                  <button
                    key={t}
                    onClick={() => setAddRoomForm(f => ({ ...f, type: t }))}
                    className={`flex-1 py-2 rounded-xl text-sm font-bold capitalize transition-all ${addRoomForm.type === t ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}
                  >
                    {t === 'room' ? 'Room' : 'Commercial'}
                  </button>
                ))}
              </div>

              {/* Floor Selector */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Floor</label>
                <div className="flex gap-2 flex-wrap">
                  {floors.map(f => (
                    <button
                      key={f}
                      onClick={() => { setAddRoomFloor(f); setAddRoomDuplicate(false) }}
                      className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${addRoomFloor === f ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}
                    >
                      Floor {f}
                    </button>
                  ))}
                  {floors.length === 0 && (
                    <span className="text-sm text-gray-400 dark:text-gray-500 py-2">Floor 1</span>
                  )}
                </div>
              </div>

              {/* Room Number */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Room Number / Label</label>
                <input
                  type="text"
                  value={addRoomForm.number}
                  onChange={e => { setAddRoomForm(f => ({ ...f, number: e.target.value })); setAddRoomDuplicate(false) }}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddRoom() }}
                  className="w-full bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl px-4 py-2.5 text-gray-900 dark:text-white text-sm outline-none focus:border-blue-500"
                  placeholder="e.g. 101 or A1"
                  autoFocus
                />
              </div>

              {/* Section */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Section (optional)</label>
                <select
                  value={addRoomForm.section}
                  onChange={e => { setAddRoomForm(f => ({ ...f, section: e.target.value })); setAddRoomDuplicate(false) }}
                  className="w-full bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl px-4 py-2.5 text-gray-900 dark:text-white text-sm outline-none focus:border-blue-500"
                >
                  <option value="">None</option>
                  <option value="upper">Upper</option>
                  <option value="front">Front</option>
                  <option value="middle">Middle</option>
                  <option value="rear">Rear</option>
                </select>
              </div>

              {/* Duplicate Warning */}
              {addRoomDuplicate && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-xl px-4 py-3">
                  <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                    A room with this number{addRoomForm.section ? ` and section` : ''} already exists on Floor {addRoomFloor}. Add anyway?
                  </p>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => { setShowAddRoom(false); setAddRoomDuplicate(false) }}
                  className="flex-1 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl text-sm font-bold"
                >
                  Cancel
                </button>
                {addRoomDuplicate ? (
                  <button
                    onClick={() => handleAddRoom(true)}
                    disabled={addRoomSaving}
                    className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white rounded-xl text-sm font-bold"
                  >
                    {addRoomSaving ? 'Adding...' : 'Add Anyway'}
                  </button>
                ) : (
                  <button
                    onClick={() => handleAddRoom()}
                    disabled={addRoomSaving}
                    className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-xl text-sm font-bold"
                  >
                    {addRoomSaving ? 'Adding...' : 'Add'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      }
    </div>
  )
}

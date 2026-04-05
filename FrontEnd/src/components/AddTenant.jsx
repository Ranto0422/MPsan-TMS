import { useState, useEffect } from 'react'
import { authFetch } from '../auth.js'
import ApplianceInput, { calculateApplianceSurcharge, formatAppliancesForAPI } from './ApplianceInput.jsx'

export default function AddTenant({ defaultRoom = '', rooms = [], onSaved, propertyId = null, onCancel, properties = [], selectedPropertyId = null, onPropertyChange, floor = null, roomType = 'room' }) {
  const [name, setName] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [homeLocation, setHomeLocation] = useState('')
  const [workPlace, setWorkPlace] = useState('')
  const [selectedRooms, setSelectedRooms] = useState(defaultRoom ? [defaultRoom] : []) // Array for batch rent
  const [payment, setPayment] = useState('1500') // Per room payment
  const [occupants, setOccupants] = useState('1')
  const [otherOccupants, setOtherOccupants] = useState([])
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [paymentDay, setPaymentDay] = useState('')
  const [idPhoto, setIdPhoto] = useState(null)
  const [otherDocuments, setOtherDocuments] = useState([])  // Array of files (PDF, PNG, JPG, etc.)
  const [appliances, setAppliances] = useState([])  // Array of {name, surcharge}
  const [advancePaid, setAdvancePaid] = useState(true)  // 1 month advance payment
  const [depositPaid, setDepositPaid] = useState(true)  // 1 month deposit payment
  const [advanceAmountInput, setAdvanceAmountInput] = useState('')  // Editable advance amount
  const [depositAmountInput, setDepositAmountInput] = useState('')  // Editable deposit amount
  const [advancePaymentDate, setAdvancePaymentDate] = useState('')  // Date advance was paid
  const [depositPaymentDate, setDepositPaymentDate] = useState('')  // Date deposit was paid
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)
  const [errorModal, setErrorModal] = useState({ show: false, title: '', message: '' })
  const [selectedProperty, setSelectedProperty] = useState(propertyId || selectedPropertyId || null)
  const [availableRooms, setAvailableRooms] = useState([])
  const [roomsByFloor, setRoomsByFloor] = useState({}) // For batch mode: rooms grouped by floor
  const [batchMode, setBatchMode] = useState(false) // Toggle for batch rent mode
  const [includeApplianceSurchargeInDeposits, setIncludeApplianceSurchargeInDeposits] = useState(true) // Whether to include appliance surcharge in advance/deposit

  // DNR warning state
  const [dnrWarning, setDnrWarning] = useState(null) // { matches: [...], source: 'search'|'field' }
  const [pendingDnrTenant, setPendingDnrTenant] = useState(null) // tenant waiting for DNR confirmation

  // Returning tenant search state
  const [searchQuery, setSearchQuery] = useState('')
  const [formerTenants, setFormerTenants] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [selectedFormerTenant, setSelectedFormerTenant] = useState(null)
  const [showFormerTenantSearch, setShowFormerTenantSearch] = useState(false)

  // Search for former tenants (debounced)
  useEffect(() => {
    if (!searchQuery || searchQuery.length < 2) {
      setFormerTenants([])
      return
    }

    const timer = setTimeout(async () => {
      setSearchLoading(true)
      try {
        const propParam = selectedProperty ? `&property_id=${selectedProperty}` : ''
        const res = await authFetch(`/api/tenants/search-former/?q=${encodeURIComponent(searchQuery)}${propParam}`)
        if (res && res.ok) {
          const data = await res.json()
          setFormerTenants(data.results || [])
        }
      } catch (err) {
        console.error('Error searching former tenants:', err)
      } finally {
        setSearchLoading(false)
      }
    }, 300) // 300ms debounce

    return () => clearTimeout(timer)
  }, [searchQuery, selectedProperty])

  // Check phone/email against DNR list when adding a new tenant (not returning)
  useEffect(() => {
    if (selectedFormerTenant) return // skip if re-registering a returning tenant
    if (!phone && !email) { setDnrWarning(null); return }

    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams()
        if (phone) params.set('phone', phone)
        if (email) params.set('email', email)
        if (selectedProperty) params.set('property_id', selectedProperty)
        const res = await authFetch(`/api/tenants/check-dnr/?${params}`)
        if (res && res.ok) {
          const data = await res.json()
          if (data.matches && data.matches.length > 0) {
            setDnrWarning({ matches: data.matches, source: 'field' })
          } else {
            setDnrWarning(null)
          }
        }
      } catch (err) {
        console.error('DNR check failed:', err)
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [phone, email, selectedProperty, selectedFormerTenant])

  // Select a former tenant to re-register — pre-fill basic info only; appliances and additional occupants start empty (user adds new)
  const selectFormerTenant = async (tenant) => {
    // If blacklisted, show DNR confirmation first
    if (tenant.blacklisted) {
      setPendingDnrTenant(tenant)
      setDnrWarning({
        matches: [{
          owner_name: tenant.dnr_owner_name || 'the owner',
          matched_field: 'tenant',
          blacklist_reason: tenant.blacklist_reason || '',
        }],
        source: 'search',
      })
      return
    }
    await confirmSelectFormerTenant(tenant)
  }

  const confirmSelectFormerTenant = async (tenant) => {
    const tenantId = tenant.tenant_id ?? tenant.id
    setSelectedFormerTenant(tenant)
    setName(tenant.full_name)
    setEmail(tenant.email || '')
    setPhone(tenant.phone || '')
    setHomeLocation(tenant.home_location || '')
    setWorkPlace(tenant.work_place || '')
    if (tenant.last_payment) setPayment(String(tenant.last_payment))
    setAppliances([])
    setOtherOccupants([])
    setSearchQuery('')
    setFormerTenants([])
    setShowFormerTenantSearch(false)
    setDnrWarning(null)
    setPendingDnrTenant(null)
    try {
      const res = await authFetch(`/api/tenants/${tenantId}/former-details/`)
      if (res && res.ok) {
        const data = await res.json()
        setSelectedFormerTenant(data)
        if (data.last_payment) setPayment(String(data.last_payment))
      }
    } catch (err) {
      console.error('Failed to fetch former tenant details:', err)
    }
  }

  // Clear former tenant selection
  const clearFormerTenantSelection = () => {
    setSelectedFormerTenant(null)
    setName('')
    setBusinessName('')
    setEmail('')
    setPhone('')
    setHomeLocation('')
    setWorkPlace('')
    setPayment('1500')
    setAppliances([])
    setOtherOccupants([])
  }

  // Calculate total rent (base + appliance surcharges)
  const baseRent = Number(payment) || 0
  const applianceSurcharge = calculateApplianceSurcharge(appliances)
  const totalRent = baseRent + applianceSurcharge

  // Calculate initial move-in payment (advance + deposit)
  // In batch mode use all selected rooms so advance/deposit are total for all rooms; otherwise single room
  const roomCount = batchMode ? Math.max(1, selectedRooms.length) : 1
  // Use base or total rent based on checkbox
  const rentForAdvanceDeposit = includeApplianceSurchargeInDeposits ? totalRent : baseRent
  const totalRentAllRoomsForAdvanceDeposit = rentForAdvanceDeposit * roomCount
  // Use custom amounts if provided, otherwise default to (monthly rent × number of rooms)
  const advanceAmount = advancePaid ? (advanceAmountInput !== '' ? Number(advanceAmountInput) : totalRentAllRoomsForAdvanceDeposit) : 0
  const depositAmount = depositPaid ? (depositAmountInput !== '' ? Number(depositAmountInput) : totalRentAllRoomsForAdvanceDeposit) : 0
  const initialPayment = advanceAmount + depositAmount

  // Fetch available rooms when property changes
  // In batch mode, fetch all floors with detailed info; in single mode, filter by current floor
  useEffect(() => {
    const fetchAvailableRooms = async () => {
      if (!selectedProperty) {
        setAvailableRooms([])
        setRoomsByFloor({})
        return
      }

      try {
        // In batch mode, fetch detailed room info (with floor) for all floors
        // In single mode, filter by floor if provided
        let url = `/api/properties/${selectedProperty}/rooms/`
        if (batchMode) {
          url += '?detailed=true'
        } else if (floor) {
          url += `?floor=${floor}`
        }

        const res = await authFetch(url)
        if (res && res.ok) {
          const roomsData = await res.json()

          if (Array.isArray(roomsData)) {
            if (batchMode && roomsData.length > 0 && typeof roomsData[0] === 'object') {
              // Detailed response with floor info - group by floor
              const grouped = {}
              roomsData.forEach(room => {
                const floorNum = room.floor || 1
                if (!grouped[floorNum]) {
                  grouped[floorNum] = []
                }
                grouped[floorNum].push(room.name)
              })
              setRoomsByFloor(grouped)
              // Also set flat list for validation
              setAvailableRooms(roomsData.map(r => r.name))
            } else {
              // Simple string array response
              const sortedRooms = roomsData.map(r => String(r))
              setAvailableRooms(sortedRooms)
              setRoomsByFloor({})
            }

            // If defaultRoom is not in the list, clear it
            const roomNames = batchMode && roomsData.length > 0 && typeof roomsData[0] === 'object'
              ? roomsData.map(r => r.name)
              : roomsData.map(r => String(r))
            if (defaultRoom && !roomNames.includes(String(defaultRoom))) {
              setSelectedRooms(roomNames.length > 0 ? [roomNames[0]] : [])
            }
          } else {
            setAvailableRooms([])
            setRoomsByFloor({})
          }
        } else {
          // Fallback to passed rooms prop if API fails
          const sortedRooms = [...rooms].sort((a, b) => {
            return String(a).localeCompare(String(b), undefined, { numeric: true })
          })
          setAvailableRooms(sortedRooms.map(String))
          setRoomsByFloor({})
        }
      } catch (err) {
        console.error('Error fetching available rooms:', err)
        // Fallback to passed rooms prop
        const sortedRooms = [...rooms].sort((a, b) => {
          return String(a).localeCompare(String(b), undefined, { numeric: true })
        })
        setAvailableRooms(sortedRooms.map(String))
        setRoomsByFloor({})
      }
    }

    fetchAvailableRooms()
  }, [selectedProperty, defaultRoom, rooms, floor, batchMode])

  // Toggle room selection for batch mode
  const toggleRoomSelection = (room) => {
    if (selectedRooms.includes(room)) {
      setSelectedRooms(selectedRooms.filter(r => r !== room))
    } else {
      setSelectedRooms([...selectedRooms, room])
    }
  }

  // Calculate total payment for all selected rooms
  const totalPaymentAllRooms = (baseRent + applianceSurcharge) * (batchMode ? selectedRooms.length : 1)

  // Upload documents for a tenant
  const uploadDocuments = async (tenantId) => {
    if (!tenantId) {
      console.error('uploadDocuments: No tenantId provided')
      return
    }

    // Upload ID photo if provided
    if (idPhoto) {
      try {
        const formData = new FormData()
        formData.append('file', idPhoto)
        formData.append('document_type', 'id_photo')
        formData.append('is_primary_id', 'true')

        const res = await authFetch(`/api/tenants/${tenantId}/documents/upload/`, {
          method: 'POST',
          body: formData,
        })
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}))
          console.error('Failed to upload ID photo:', res.status, errData)
        }
      } catch (err) {
        console.error('Failed to upload ID photo:', err)
      }
    }

    // Upload other documents if provided
    if (otherDocuments.length > 0) {
      try {
        const formData = new FormData()
        otherDocuments.forEach(doc => {
          formData.append('files', doc)
        })
        formData.append('document_type', 'other')

        const res = await authFetch(`/api/tenants/${tenantId}/documents/upload/`, {
          method: 'POST',
          body: formData,
        })
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}))
          console.error('Failed to upload other documents:', res.status, errData)
        }
      } catch (err) {
        console.error('Failed to upload other documents:', err)
      }
    }

    // Upload other occupant ID photos if provided
    for (let i = 0; i < otherOccupants.length; i++) {
      const occ = otherOccupants[i]
      if (occ.id_photo) {
        try {
          const formData = new FormData()
          formData.append('file', occ.id_photo)
          formData.append('document_type', 'id_photo')
          formData.append('description', `Other Occupant: ${occ.full_name || 'Occupant ' + (i + 1)}${occ.relationship ? ' (' + occ.relationship + ')' : ''}`)

          const res = await authFetch(`/api/tenants/${tenantId}/documents/upload/`, {
            method: 'POST',
            body: formData,
          })
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}))
            console.error(`Failed to upload ID photo for occupant ${i + 1}:`, res.status, errData)
          }
        } catch (err) {
          console.error(`Failed to upload ID photo for occupant ${i + 1}:`, err)
        }
      }
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    // Basic validation: name, phone (required), at least one room
    const roomsToAssign = batchMode ? selectedRooms : (selectedRooms.length > 0 ? [selectedRooms[0]] : [])
    if (!name || roomsToAssign.length === 0) {
      setError('Please provide tenant name and select at least one unit')
      return
    }
    if (roomType === 'commercial' && !businessName.trim()) {
      setError('Please provide a business name for this commercial space')
      return
    }
    const phoneTrimmed = phone ? phone.trim() : ''
    if (!phoneTrimmed) {
      setError('Please provide a phone number')
      return
    }

    // Validate & normalize Philippine phone format to +639xxxxxxxxx
    const digitsOnly = phoneTrimmed.replace(/[^0-9]/g, '')
    let normalizedPhone = ''
    if (digitsOnly.startsWith('09') && digitsOnly.length === 11) {
      normalizedPhone = '+63' + digitsOnly.substring(1)
    } else if (digitsOnly.startsWith('639') && digitsOnly.length === 12) {
      normalizedPhone = '+' + digitsOnly
    } else {
      setError('Please enter a valid Philippine phone number (e.g. 09123456789 or +639123456789)')
      return
    }

    setLoading(true)
    try {
      // If reactivating a former tenant, use the reactivate endpoint
      if (selectedFormerTenant) {
        const reactivatePayload = {
          property_id: selectedProperty || propertyId,
          room_numbers: roomsToAssign, // Array of room numbers for batch
          room_number: roomsToAssign[0], // Keep for backwards compatibility
          payment: totalRent,
          payment_day: paymentDay ? Number(paymentDay) : null,
          date_of_occupancy: date || null,
          appliances: formatAppliancesForAPI(appliances),
          other_occupants: (otherOccupants || []).map(o => ({ full_name: o.full_name || '', relationship: o.relationship || '' })),
          // Initial payment tracking (advance + deposit)
          advance_paid: advancePaid,
          advance_amount: advanceAmount,
          advance_payment_date: advancePaymentDate || null,
          deposit_paid: depositPaid,
          deposit_amount: depositAmount,
          deposit_payment_date: depositPaymentDate || null,
          include_appliance_surcharge_in_deposits: includeApplianceSurchargeInDeposits,
          force_dnr: selectedFormerTenant.blacklisted || false,
        }

        const res = await authFetch(`/api/tenants/${selectedFormerTenant.tenant_id}/reactivate/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reactivatePayload),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || `Reactivation failed: ${res.status}`)
        }

        const data = await res.json()

        // Upload documents if provided (including other occupant ID photos)
        const tenantId = data.tenant_id || data.id
        const hasOccupantPhotos = otherOccupants.some(occ => occ.id_photo)
        if (tenantId && (idPhoto || otherDocuments.length > 0 || hasOccupantPhotos)) {
          await uploadDocuments(tenantId)
        }

        setSuccess(true)
        setTimeout(() => {
          if (typeof onSaved === 'function') onSaved(data)
        }, 900)
      } else {
        // Creating a new tenant with batch room support
        const payload = {
          name,
          full_name: name,
          business_name: roomType === 'commercial' ? businessName.trim() : '',
          email: email ? email.trim() : '',
          phone: normalizedPhone,
          home_location: homeLocation,
          work_place: workPlace,
          room_numbers: roomsToAssign, // Array of room numbers for batch
          unit_no: roomsToAssign[0], // Keep for backwards compatibility
          room_no: roomsToAssign[0],
          property_id: selectedProperty || propertyId,
          payment: totalRent,  // Per-room rent including appliance surcharges
          base_rent: baseRent,
          appliance_surcharge: applianceSurcharge,
          occupants: 1 + otherOccupants.length,
          other_occupants_count: otherOccupants.length,
          other_occupants: (otherOccupants || []).map(o => ({ full_name: o.full_name || '', relationship: o.relationship || '' })),
          date_of_occupancy: date || null,
          payment_day: paymentDay ? Number(paymentDay) : null,
          id_photo_url: idPhoto ? idPhoto.name : 'placeholder.jpg',
          appliances: formatAppliancesForAPI(appliances),
          // Initial payment tracking (advance + deposit)
          advance_paid: advancePaid,
          advance_amount: advanceAmount,
          advance_payment_date: advancePaymentDate || null,
          deposit_paid: depositPaid,
          deposit_amount: depositAmount,
          deposit_payment_date: depositPaymentDate || null,
          include_appliance_surcharge_in_deposits: includeApplianceSurchargeInDeposits,
        }

        const res = await authFetch('/api/tenants/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          // Try to parse validation errors from backend
          try {
            const errorData = await res.json()
            // Check for specific field errors (email, phone duplicates)
            if (errorData.email) {
              const emailError = Array.isArray(errorData.email) ? errorData.email[0] : errorData.email
              setErrorModal({
                show: true,
                title: 'Duplicate Email',
                message: `The email "${email}" is already registered to another tenant. Please use a different email address or search for the existing tenant to reactivate them.`
              })
              setLoading(false)
              return
            }
            if (errorData.phone) {
              const phoneError = Array.isArray(errorData.phone) ? errorData.phone[0] : errorData.phone
              setErrorModal({
                show: true,
                title: 'Duplicate Phone Number',
                message: `The phone number "${phone}" is already registered to another tenant. Please use a different phone number or search for the existing tenant to reactivate them.`
              })
              setLoading(false)
              return
            }
            // Generic validation error
            const errorMessages = Object.entries(errorData)
              .map(([field, msgs]) => `${field}: ${Array.isArray(msgs) ? msgs.join(', ') : msgs}`)
              .join('\n')
            throw new Error(errorMessages || 'Validation failed')
          } catch (parseErr) {
            if (parseErr.message && !parseErr.message.includes('Unexpected')) {
              throw parseErr
            }
            const txt = await res.text().catch(() => '')
            throw new Error(`Save failed: ${res.status} ${txt}`)
          }
        }
        const data = await res.json()

        // Upload documents if provided (including other occupant ID photos)
        const tenantId = data.tenant_id || data.id
        const hasOccupantPhotos = otherOccupants.some(occ => occ.id_photo)
        console.log('Tenant created:', { tenantId, hasIdPhoto: !!idPhoto, otherDocsCount: otherDocuments.length, hasOccupantPhotos })
        if (tenantId && (idPhoto || otherDocuments.length > 0 || hasOccupantPhotos)) {
          console.log('Uploading documents for tenant:', tenantId)
          await uploadDocuments(tenantId)
          console.log('Document upload completed')
        }

        setSuccess(true)
        setTimeout(() => {
          if (typeof onSaved === 'function') onSaved(data)
        }, 900)
      }
    } catch (err) {
      console.error('AddTenant error:', err)
      setError(err.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  // update selectedRooms when defaultRoom prop changes (e.g., opened from a sidebar)
  useEffect(() => {
    // if defaultRoom is provided and exists in the available rooms list, select it.
    if (defaultRoom && availableRooms && availableRooms.length && availableRooms.includes(String(defaultRoom))) {
      setSelectedRooms([String(defaultRoom)])
    } else if (availableRooms && availableRooms.length && selectedRooms.length === 0) {
      setSelectedRooms([availableRooms[0]])
    }
  }, [defaultRoom, availableRooms])

  // sync selectedProperty if parent changes selection
  useEffect(() => {
    if (selectedPropertyId) setSelectedProperty(selectedPropertyId)
  }, [selectedPropertyId])

  // auto-fill payment day based on occupancy date
  useEffect(() => {
    if (date) {
      const occupancyDate = new Date(date)
      const day = occupancyDate.getDate()
      setPaymentDay(String(day))
    }
  }, [date])

  // auto-dismiss success / error messages after a short time
  useEffect(() => {
    if (success) {
      const t = setTimeout(() => setSuccess(false), 3000)
      return () => clearTimeout(t)
    }
  }, [success])
  useEffect(() => {
    if (error) {
      const t = setTimeout(() => setError(null), 5000)
      return () => clearTimeout(t)
    }
  }, [error])

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-6 sm:py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <button
            type="button"
            onClick={() => { if (typeof onCancel === 'function') onCancel() }}
            className="p-2.5 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 transition-all active:scale-90 mb-4 inline-flex items-center gap-2 px-4"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
            </svg>
            <span className="font-medium">Back</span>
          </button>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">{roomType === 'commercial' ? 'Add Commercial Tenant' : 'Add New Tenant'}</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1 sm:mt-2 text-sm sm:text-base">{roomType === 'commercial' ? 'Complete the form below to register a commercial tenant' : 'Complete the form below to register a new tenant'}</p>
        </div>

        {/* Success/Error Messages */}
        {success && (
          <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/50 rounded-xl flex items-start gap-3 animate-in fade-in slide-in-from-top-4 duration-300">
            <div className="w-10 h-10 bg-green-100 dark:bg-green-900/40 rounded-full flex items-center justify-center flex-shrink-0">
              <svg className="w-6 h-6 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <div className="font-semibold text-green-800 dark:text-green-300">Success!</div>
              <div className="text-sm text-green-700 dark:text-green-400/90">Tenant has been added successfully. Redirecting...</div>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 rounded-xl flex items-start gap-3 animate-in shake duration-300">
            <div className="w-10 h-10 bg-red-100 dark:bg-red-900/40 rounded-full flex items-center justify-center flex-shrink-0">
              <svg className="w-6 h-6 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <div className="font-semibold text-red-800 dark:text-red-300">Error Occurred</div>
              <div className="text-sm text-red-700 dark:text-red-400/90">{error}</div>
            </div>
          </div>
        )}

        {/* Error Modal for Duplicate Email/Phone */}
        {errorModal.show && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in duration-200">
              {/* Header */}
              <div className="bg-red-50 dark:bg-red-900/20 px-6 py-5 border-b border-red-100 dark:border-red-900/30">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-red-100 dark:bg-red-900/40 rounded-full flex items-center justify-center flex-shrink-0">
                    <svg className="w-7 h-7 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-bold text-red-800 dark:text-red-300">{errorModal.title}</h3>
                </div>
              </div>

              {/* Body */}
              <div className="px-6 py-5 space-y-4">
                <p className="text-gray-700 dark:text-gray-300 leading-relaxed text-base">{errorModal.message}</p>
                <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-xl">
                  <p className="text-sm text-amber-800 dark:text-amber-300 flex items-start gap-3">
                    <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                    </svg>
                    <span>
                      <strong className="block mb-1">Recommended Action:</strong> Use the "Returning Tenant?" search below to find and reactivate existing records instead of creating duplicates.
                    </span>
                  </p>
                </div>
              </div>

              {/* Footer */}
              <div className="px-6 py-4 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-100 dark:border-gray-700">
                <button
                  onClick={() => setErrorModal({ show: false, title: '', message: '' })}
                  className="w-full px-4 py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl transition-all shadow-lg shadow-red-500/20"
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )}

        {/* DNR Confirmation Modal — when selecting a blacklisted returning tenant */}
        {dnrWarning && dnrWarning.source === 'search' && pendingDnrTenant && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in duration-200">
              <div className="bg-red-50 dark:bg-red-900/20 px-6 py-5 border-b border-red-100 dark:border-red-900/30">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-red-100 dark:bg-red-900/40 rounded-full flex items-center justify-center flex-shrink-0">
                    <svg className="w-7 h-7 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-bold text-red-800 dark:text-red-300">Do Not Rent</h3>
                </div>
              </div>
              <div className="px-6 py-5 space-y-3">
                <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
                  <strong>{dnrWarning.matches[0]?.owner_name}</strong> has marked <strong>{pendingDnrTenant.full_name}</strong> as Do Not Rent.
                </p>
                {dnrWarning.matches[0]?.blacklist_reason && (
                  <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
                    <p className="text-sm text-red-700 dark:text-red-400 italic">
                      Reason: {dnrWarning.matches[0].blacklist_reason}
                    </p>
                  </div>
                )}
                <p className="text-sm text-gray-600 dark:text-gray-400">Do you still want to add this tenant?</p>
              </div>
              <div className="px-6 py-4 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-100 dark:border-gray-700 flex gap-3">
                <button
                  onClick={() => { setDnrWarning(null); setPendingDnrTenant(null) }}
                  className="flex-1 px-4 py-3 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 font-semibold rounded-xl transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={() => confirmSelectFormerTenant(pendingDnrTenant)}
                  className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl transition-all shadow-lg shadow-red-500/20"
                >
                  Add Anyway
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Property Selection */}
        {properties && properties.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5 sm:p-6 mb-6 border border-gray-100 dark:border-gray-700">
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2.5">
              Select Property <span className="text-red-500">*</span>
            </label>
            <select
              value={selectedProperty || ''}
              onChange={async (e) => {
                const val = e.target.value || null
                setSelectedProperty(val)
                try {
                  if (typeof onPropertyChange === 'function') await onPropertyChange(val)
                } catch (err) { }
              }}
              className="w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-3 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none appearance-none"
              required
            >
              <option value="">Select a property</option>
              {properties.map(p => (
                <option key={p.id} value={p.id}>{p.name || p.propertyName || `Property ${p.id}`}</option>
              ))}
            </select>
          </div>
        )}

        {/* Returning Tenant Search Section */}
        <div className="bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-900/10 dark:to-orange-900/10 rounded-2xl shadow-sm p-6 mb-8 border border-amber-200/60 dark:border-amber-700/30">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2.5">
              <div className="w-8 h-8 bg-amber-100 dark:bg-amber-900/40 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              Returning Tenant?
            </h2>
            <button
              type="button"
              onClick={() => setShowFormerTenantSearch(!showFormerTenantSearch)}
              className="text-sm px-4 py-1.5 bg-white dark:bg-gray-800 border border-amber-200 dark:border-amber-700 text-amber-700 dark:text-amber-400 rounded-full hover:bg-amber-50 dark:hover:bg-amber-900/30 font-semibold transition-all shadow-sm"
            >
              {showFormerTenantSearch ? 'Close' : 'Search Database'}
            </button>
          </div>

          {selectedFormerTenant ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-green-200 dark:border-green-900/50 shadow-sm animate-in zoom-in-95 duration-200">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-bold text-gray-900 dark:text-white text-lg truncate">{selectedFormerTenant.full_name}</p>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">{selectedFormerTenant.email || 'No Email'} • {selectedFormerTenant.phone}</p>
                  {selectedFormerTenant.last_room && (
                    <div className="flex items-center gap-2 mt-2 py-1 px-2.5 bg-gray-50 dark:bg-gray-700/50 rounded-lg w-fit">
                      <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                      </svg>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        Previously: Room {selectedFormerTenant.last_room}
                        {selectedFormerTenant.move_out && ` (Out: ${new Date(selectedFormerTenant.move_out).toLocaleDateString()})`}
                      </span>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={clearFormerTenantSelection}
                  className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </button>
              </div>
              <div className="mt-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-800/30 rounded-lg flex items-center gap-2.5">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <p className="text-xs font-semibold text-green-700 dark:text-green-400">
                  Ready to reactivate. Personal details are pre-filled.
                </p>
              </div>
            </div>
          ) : showFormerTenantSearch ? (
            <div className="space-y-4 animate-in slide-in-from-top-2 duration-200">
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <svg className="w-5 h-5 text-gray-400 group-focus-within:text-amber-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by name, email, or phone..."
                  className="w-full bg-white dark:bg-gray-800 border-2 border-transparent focus:border-amber-400 dark:focus:border-amber-600 rounded-xl px-4 py-3.5 pl-11 text-gray-900 dark:text-white shadow-sm transition-all outline-none"
                />
                {searchLoading && (
                  <div className="absolute inset-y-0 right-0 pr-4 flex items-center">
                    <svg className="w-5 h-5 text-amber-500 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  </div>
                )}
              </div>

              {/* Search Results */}
              {formerTenants.length > 0 && (
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 max-h-72 overflow-y-auto shadow-lg divide-y divide-gray-100 dark:divide-gray-700">
                  {formerTenants.map((tenant) => (
                    <button
                      key={tenant.tenant_id}
                      type="button"
                      onClick={() => selectFormerTenant(tenant)}
                      className={`w-full text-left px-5 py-4 transition-colors ${tenant.blacklisted ? 'hover:bg-red-50 dark:hover:bg-red-900/10 bg-red-50/30' : 'hover:bg-amber-50 dark:hover:bg-amber-900/10'
                        }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-bold text-gray-900 dark:text-white truncate">{tenant.full_name}</p>
                          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{tenant.email || 'No Email'} • {tenant.phone}</p>
                          {tenant.last_room && (
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-2 flex items-center gap-1.5">
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              Last Room: {tenant.last_room}
                              {tenant.last_payment && ` • Last Pmt: P${tenant.last_payment.toLocaleString()}`}
                            </p>
                          )}
                        </div>
                        {tenant.blacklisted ? (
                          <span className="flex-shrink-0 text-[10px] uppercase tracking-wider font-bold px-2 py-1 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-md border border-red-200 dark:border-red-800/50">
                            DNR
                          </span>
                        ) : (
                          <span className="flex-shrink-0 text-[10px] uppercase tracking-wider font-bold px-2 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-md border border-amber-200 dark:border-amber-800/50">
                            Select
                          </span>
                        )}
                      </div>
                      {tenant.blacklisted && tenant.blacklist_reason && (
                        <div className="mt-3 p-2.5 bg-red-50 dark:bg-red-900/20 rounded-lg">
                          <p className="text-xs text-red-600 dark:text-red-400 italic">
                            Reason: {tenant.blacklist_reason}
                          </p>
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {searchQuery.length >= 2 && formerTenants.length === 0 && !searchLoading && (
                <div className="text-center py-8 bg-white dark:bg-gray-800 rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
                  <p className="text-sm text-gray-400">No matching records found for "{searchQuery}"</p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400 pl-10.5 leading-relaxed">
              Quickly re-register past occupants by searching our database. This prevents duplicate profiles and keeps history intact.
            </p>
          )}
        </div>

        {/* Main Form */}
        <form onSubmit={handleSubmit} className="space-y-6 sm:space-y-8">
          {/* Personal Information Section */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-6 sm:p-8 border border-gray-100 dark:border-gray-700">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6 flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/40 rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              {roomType === 'commercial' ? 'Business Information' : 'Personal Information'}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
              {roomType === 'commercial' && (
                <div className="md:col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Business Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={businessName}
                    onChange={e => setBusinessName(e.target.value)}
                    className="w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-3 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none"
                    placeholder="e.g., ABC Trading Corporation"
                    required
                  />
                </div>
              )}
              <div className="md:col-span-2">
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  {roomType === 'commercial' ? 'Contact Person' : 'Full Name'} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-3 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none"
                  placeholder={roomType === 'commercial' ? 'Contact person name' : 'John Doe'}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  Email Address <span className="text-gray-400 dark:text-gray-500 font-normal ml-1">(Optional)</span>
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-3 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none"
                  placeholder="john@example.com"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  Phone Number <span className="text-red-500">*</span>
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  className="w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-3 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none"
                  placeholder="09123456789 or +639123456789"
                  required
                />
              </div>

              {/* DNR Warning Banner — shown when phone/email matches a blacklisted tenant */}
              {dnrWarning && dnrWarning.source === 'field' && (
                <div className="md:col-span-2 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 rounded-xl">
                  <div className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <div>
                      <p className="text-sm font-semibold text-red-800 dark:text-red-300">DNR Warning</p>
                      {dnrWarning.matches.map((m, i) => (
                        <p key={i} className="text-sm text-red-700 dark:text-red-400 mt-1">
                          <strong>{m.owner_name}</strong> has this {m.matched_field} marked as Do Not Rent.
                          {m.blacklist_reason && <span className="italic"> Reason: {m.blacklist_reason}</span>}
                        </p>
                      ))}
                      <p className="text-xs text-red-600 dark:text-red-500 mt-2">You can still proceed if you wish to add this tenant.</p>
                    </div>
                  </div>
                </div>
              )}

              {/* ID Photo Upload */}
              <div className="md:col-span-2 mt-2">
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                  Identification Photo
                </label>
                <div className="flex items-center gap-5">
                  <div className="flex-shrink-0">
                    {idPhoto ? (
                      <div className="relative group">
                        <img
                          src={URL.createObjectURL(idPhoto)}
                          alt="ID Preview"
                          className="w-24 h-24 sm:w-28 sm:h-28 object-cover rounded-2xl border-2 border-blue-500 shadow-md"
                        />
                        <button
                          type="button"
                          onClick={() => setIdPhoto(null)}
                          className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-lg hover:bg-red-600 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ) : (
                      <div className="w-24 h-24 sm:w-28 sm:h-28 bg-gray-100 dark:bg-gray-700 rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-600 flex flex-col items-center justify-center text-gray-400 dark:text-gray-500">
                        <svg className="w-8 h-8 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <span className="text-[10px] uppercase font-bold tracking-wider">No Image</span>
                      </div>
                    )}
                  </div>
                  <label className="flex-1 max-w-sm cursor-pointer group">
                    <div className="bg-gray-50 dark:bg-gray-700/50 hover:bg-blue-50 dark:hover:bg-blue-900/20 border-2 border-dashed border-gray-300 dark:border-gray-600 group-hover:border-blue-400 dark:group-hover:border-blue-500 rounded-2xl p-5 sm:p-6 transition-all text-center">
                      <svg className="w-8 h-8 text-gray-400 dark:text-gray-500 group-hover:text-blue-500 transition-colors mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                      <div className="text-sm font-bold text-gray-700 dark:text-gray-300 group-hover:text-blue-600 dark:group-hover:text-blue-400">Click to upload ID</div>
                      <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">PNG, JPG up to 10MB</div>
                    </div>
                    <input
                      type="file"
                      onChange={e => setIdPhoto(e.target.files && e.target.files[0] ? e.target.files[0] : null)}
                      className="hidden"
                      accept="image/*"
                    />
                  </label>
                </div>
              </div>

              {/* Other Documents Upload */}
              <div className="md:col-span-2 mt-2">
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                  Other Documents <span className="text-gray-400 dark:text-gray-500 font-normal ml-1">(Optional)</span>
                </label>
                <div
                  className="cursor-pointer border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-2xl px-6 py-6 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-all text-center group"
                  onClick={() => document.getElementById('other-documents-input').click()}
                >
                  <svg className="w-10 h-10 text-gray-400 dark:text-gray-500 group-hover:text-blue-500 transition-colors mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <div className="text-sm font-bold text-gray-700 dark:text-gray-300 group-hover:text-blue-600 dark:group-hover:text-blue-400">Click to upload supplemental documents</div>
                  <div className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">PDF, Word, or Images (Multiple files allowed)</div>
                </div>
                <input
                  id="other-documents-input"
                  type="file"
                  onChange={e => {
                    if (e.target.files && e.target.files.length > 0) {
                      const newFiles = Array.from(e.target.files)
                      setOtherDocuments(prev => [...prev, ...newFiles])
                    }
                    e.target.value = '' // Reset input to allow selecting same file again
                  }}
                  className="hidden"
                  accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.gif,.bmp,.webp"
                  multiple
                />

                {/* Display uploaded documents */}
                {otherDocuments.length > 0 && (
                  <div className="mt-5 space-y-2.5">
                    <div className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">{otherDocuments.length} document{otherDocuments.length !== 1 ? 's' : ''} selected</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {otherDocuments.map((doc, idx) => (
                        <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl border border-gray-200 dark:border-gray-600 group/file transition-all hover:bg-white dark:hover:bg-gray-700 hover:shadow-sm">
                          <div className="flex items-center gap-3 min-w-0">
                            {/* Icon based on file type */}
                            <div className="w-9 h-9 flex-shrink-0 flex items-center justify-center bg-white dark:bg-gray-600 rounded-lg shadow-xs group-hover/file:scale-110 transition-transform">
                              {doc.type.includes('pdf') ? (
                                <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                                </svg>
                              ) : doc.type.includes('image') ? (
                                <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                              ) : (
                                <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 truncate">{doc.name}</p>
                              <p className="text-[10px] text-gray-400 uppercase font-bold">{(doc.size / 1024).toFixed(1)} KB</p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setOtherDocuments(otherDocuments.filter((_, i) => i !== idx))}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => setOtherDocuments([])}
                      className="text-xs text-red-600 dark:text-red-400 hover:underline font-bold tracking-tight mt-1 flex items-center gap-1"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      Clear all documents
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Unit & Payment Section */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-6 sm:p-8 border border-gray-100 dark:border-gray-700">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
                <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/40 rounded-xl flex items-center justify-center">
                  <svg className="w-6 h-6 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                </div>
                Unit & Payment Details
              </h2>
              <label className="hidden flex items-center gap-2.5 cursor-pointer bg-purple-50 dark:bg-purple-900/10 px-3 py-1.5 rounded-full border border-purple-100 dark:border-purple-800/30 w-fit">
                <input
                  type="checkbox"
                  checked={batchMode}
                  onChange={(e) => setBatchMode(e.target.checked)}
                  className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500 border-gray-300 dark:border-gray-600"
                />
                <span className="text-xs font-bold text-purple-700 dark:text-purple-400 uppercase tracking-tight">Batch Rent (Multiple Rooms)</span>
              </label>
            </div>

            {batchMode ? (
              /* Batch Mode - Multi-select rooms grouped by floor */
              <div className="mb-6">
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2.5">
                  Select Rooms <span className="text-red-500">*</span>
                  <span className="ml-2 text-purple-600 dark:text-purple-400 font-normal">({selectedRooms.length} selected)</span>
                </label>
                <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 max-h-72 overflow-y-auto bg-gray-50 dark:bg-gray-900/50">
                  {availableRooms.length === 0 ? (
                    <div className="text-center py-6">
                      <p className="text-sm text-amber-600 dark:text-amber-500 font-medium">No available units in this property</p>
                    </div>
                  ) : Object.keys(roomsByFloor).length > 0 ? (
                    /* Grouped by floor */
                    <div className="space-y-4">
                      {Object.keys(roomsByFloor).sort((a, b) => Number(a) - Number(b)).map(floorNum => (
                        <div key={floorNum} className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-gray-100 dark:border-gray-700 shadow-sm">
                          <div className="flex items-center gap-2 mb-3 pb-2 border-b border-gray-50 dark:border-gray-700/50">
                            <span className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Floor {floorNum}</span>
                            <span className="text-[10px] bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded text-gray-500 dark:text-gray-400">{roomsByFloor[floorNum].length} units</span>
                          </div>
                          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                            {roomsByFloor[floorNum].map(room => {
                              const isSelected = selectedRooms.includes(room)
                              return (
                                <button
                                  key={room}
                                  type="button"
                                  onClick={() => toggleRoomSelection(room)}
                                  className={`px-2 py-2.5 rounded-xl text-sm font-bold transition-all border-2 flex items-center justify-center gap-1.5 ${isSelected
                                    ? 'bg-purple-600 border-purple-600 text-white shadow-md shadow-purple-500/20'
                                    : 'bg-gray-50 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300 border-gray-100 dark:border-transparent hover:border-purple-300 dark:hover:border-purple-500'
                                    }`}
                                >
                                  {room}
                                  {isSelected && (
                                    <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                    </svg>
                                  )}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    /* Fallback: flat list without floor grouping */
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                      {availableRooms.map(room => {
                        const isSelected = selectedRooms.includes(room)
                        return (
                          <button
                            key={room}
                            type="button"
                            onClick={() => toggleRoomSelection(room)}
                            className={`px-2 py-2.5 rounded-xl text-sm font-bold transition-all border-2 flex items-center justify-center gap-1.5 ${isSelected
                              ? 'bg-purple-600 border-purple-600 text-white shadow-lg'
                              : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-100 dark:border-gray-600 hover:border-purple-400'
                              }`}
                          >
                            {room}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
                {selectedRooms.length > 1 && (
                  <div className="mt-3 flex items-start gap-2 text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/10 p-2.5 rounded-xl border border-purple-100 dark:border-purple-800/20">
                    <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                    </svg>
                    <p className="text-xs font-semibold">
                      Same tenant will be assigned to all {selectedRooms.length} rooms with the same monthly payment per room.
                    </p>
                  </div>
                )}
              </div>
            ) : (
              /* Single Room Mode */
              <div className="mb-6">
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  Unit Number <span className="text-red-500">*</span>
                </label>
                <select
                  value={selectedRooms[0] || ''}
                  onChange={e => setSelectedRooms(e.target.value ? [e.target.value] : [])}
                  className="w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-3 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none appearance-none"
                  required
                >
                  <option value="">Select available unit</option>
                  {availableRooms.map(r => (<option key={r} value={r}>{r}</option>))}
                </select>
                {availableRooms.length === 0 && selectedProperty && (
                  <p className="text-xs text-amber-600 dark:text-amber-500 mt-2 font-medium">No available units in this property</p>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Monthly Rent per Room (₱)</label>
                <input
                  type="number"
                  value={payment}
                  onChange={e => setPayment(e.target.value)}
                  className="w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-3 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none"
                  placeholder="1500"
                  min="0"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Date of Occupancy</label>
                <input
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  className="w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-3 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none"
                />
              </div>
            </div>

            {/* Initial Payment Section (Advance + Deposit) */}
            <div className="mt-8 p-6 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/10 dark:to-emerald-900/10 rounded-2xl border border-green-200 dark:border-green-800/30">
              <h3 className="text-base font-bold text-green-800 dark:text-green-300 mb-3 flex items-center gap-2.5">
                <div className="w-8 h-8 bg-green-100 dark:bg-green-900/40 rounded-lg flex items-center justify-center">
                  <svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </div>
                Initial Move-in Payment
              </h3>
              <p className="text-sm text-green-700 dark:text-green-400/90 mb-5 leading-relaxed">
                Standard move-in requires 1 month advance + 1 month deposit. Amounts are editable for special arrangements.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* Advance Payment */}
                <div className={`p-4 rounded-2xl border-2 transition-all ${advancePaid
                  ? 'bg-white dark:bg-gray-800 border-green-500 shadow-md shadow-green-500/5'
                  : 'bg-white/50 dark:bg-gray-800/50 border-gray-100 dark:border-gray-700'
                  }`}>
                  <label className="flex items-center gap-4 cursor-pointer">
                    <div className="relative flex items-center justify-center">
                      <input
                        type="checkbox"
                        checked={advancePaid}
                        onChange={(e) => setAdvancePaid(e.target.checked)}
                        className="peer w-6 h-6 opacity-0 absolute cursor-pointer"
                      />
                      <div className={`w-6 h-6 rounded-lg border-2 transition-all flex items-center justify-center ${advancePaid ? 'bg-green-500 border-green-500' : 'border-gray-300 dark:border-gray-600'}`}>
                        {advancePaid && (
                          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                    </div>
                    <div className="flex-1">
                      <div className="font-bold text-gray-900 dark:text-white">1 Month Advance</div>
                      <div className="text-[10px] text-gray-400 dark:text-gray-500 uppercase font-bold tracking-wider">Applied to last month</div>
                    </div>
                  </label>
                  {advancePaid && (
                    <div className="mt-4 pt-4 border-t border-green-50 dark:border-green-900/30 animate-in slide-in-from-top-2 duration-200 space-y-3">
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Amount (₱)</label>
                        <input
                          type="number"
                          value={advanceAmountInput}
                          onChange={(e) => setAdvanceAmountInput(e.target.value)}
                          placeholder={`${totalRentAllRoomsForAdvanceDeposit.toLocaleString()}`}
                          className="w-full px-4 py-2.5 text-sm bg-green-50/50 dark:bg-green-900/20 border-2 border-green-100 dark:border-green-900/40 rounded-xl focus:ring-2 focus:ring-green-500/20 focus:border-green-500 dark:text-green-300 transition-all outline-none font-bold"
                          min="0"
                          step="0.01"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Date Paid</label>
                        <input
                          type="date"
                          value={advancePaymentDate}
                          onChange={(e) => setAdvancePaymentDate(e.target.value)}
                          className="w-full px-4 py-2.5 text-sm bg-green-50/50 dark:bg-green-900/20 border-2 border-green-100 dark:border-green-900/40 rounded-xl focus:ring-2 focus:ring-green-500/20 focus:border-green-500 dark:text-green-300 transition-all outline-none font-medium"
                        />
                        <p className="text-[9px] text-gray-400 dark:text-gray-500 mt-1 ml-1">Leave blank to use move-in date</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Deposit Payment */}
                <div className={`p-4 rounded-2xl border-2 transition-all ${depositPaid
                  ? 'bg-white dark:bg-gray-800 border-green-500 shadow-md shadow-green-500/5'
                  : 'bg-white/50 dark:bg-gray-800/50 border-gray-100 dark:border-gray-700'
                  }`}>
                  <label className="flex items-center gap-4 cursor-pointer">
                    <div className="relative flex items-center justify-center">
                      <input
                        type="checkbox"
                        checked={depositPaid}
                        onChange={(e) => setDepositPaid(e.target.checked)}
                        className="peer w-6 h-6 opacity-0 absolute cursor-pointer"
                      />
                      <div className={`w-6 h-6 rounded-lg border-2 transition-all flex items-center justify-center ${depositPaid ? 'bg-green-500 border-green-500' : 'border-gray-300 dark:border-gray-600'}`}>
                        {depositPaid && (
                          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                    </div>
                    <div className="flex-1">
                      <div className="font-bold text-gray-900 dark:text-white">1 Month Deposit</div>
                      <div className="text-[10px] text-gray-400 dark:text-gray-500 uppercase font-bold tracking-wider">Refundable balance</div>
                    </div>
                  </label>
                  {depositPaid && (
                    <div className="mt-4 pt-4 border-t border-green-50 dark:border-green-900/30 animate-in slide-in-from-top-2 duration-200 space-y-3">
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Amount (₱)</label>
                        <input
                          type="number"
                          value={depositAmountInput}
                          onChange={(e) => setDepositAmountInput(e.target.value)}
                          placeholder={`${totalRentAllRoomsForAdvanceDeposit.toLocaleString()}`}
                          className="w-full px-4 py-2.5 text-sm bg-green-50/50 dark:bg-green-900/20 border-2 border-green-100 dark:border-green-900/40 rounded-xl focus:ring-2 focus:ring-green-500/20 focus:border-green-500 dark:text-green-300 transition-all outline-none font-bold"
                          min="0"
                          step="0.01"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Date Paid</label>
                        <input
                          type="date"
                          value={depositPaymentDate}
                          onChange={(e) => setDepositPaymentDate(e.target.value)}
                          className="w-full px-4 py-2.5 text-sm bg-green-50/50 dark:bg-green-900/20 border-2 border-green-100 dark:border-green-900/40 rounded-xl focus:ring-2 focus:ring-green-500/20 focus:border-green-500 dark:text-green-300 transition-all outline-none font-medium"
                        />
                        <p className="text-[9px] text-gray-400 dark:text-gray-500 mt-1 ml-1">Leave blank to use move-in date</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {(!advancePaid || !depositPaid) && (
                <div className="mt-5 p-3 bg-white/50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/30 rounded-xl text-sm text-amber-700 dark:text-amber-400 flex items-center gap-3">
                  <svg className="w-5 h-5 flex-shrink-0 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  <span className="font-semibold italic">Incomplete initial payment. Tenant will owe {!advancePaid && !depositPaid ? 'both advance and deposit' : !advancePaid ? 'the advance payment' : 'the security deposit'}.</span>
                </div>
              )}
            </div>

            <div className="mt-8 space-y-6">
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
                  Preferred Monthly Payment Day <span className="text-gray-400 dark:text-gray-500 font-normal ml-1">(Optional)</span>
                </label>
                <div className="flex flex-col sm:flex-row items-start gap-6">
                  <div className="w-full max-w-sm">
                    <div className="grid grid-cols-7 gap-1.5 p-3 bg-blue-50/50 dark:bg-gray-900/40 rounded-2xl border border-blue-100 dark:border-gray-700/50">
                      {[...Array(31)].map((_, i) => {
                        const day = i + 1;
                        const selected = paymentDay == day;
                        return (
                          <button
                            key={day}
                            type="button"
                            className={`h-9 w-9 flex items-center justify-center rounded-xl font-bold text-xs transition-all duration-200
                              ${selected
                                ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20 scale-110'
                                : 'bg-white dark:bg-gray-700 dark:text-gray-300 text-blue-700 hover:bg-blue-100 dark:hover:bg-gray-600 border border-blue-50 dark:border-gray-600'}`}
                            onClick={() => setPaymentDay(String(day))}
                            aria-label={`Select day ${day}`}
                          >
                            {day}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                </div>
              </div>
            </div>
          </div>

          {/* Appliances Section */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-6 sm:p-8 border border-gray-100 dark:border-gray-700">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-3">
              <div className="w-10 h-10 bg-orange-100 dark:bg-orange-900/40 rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6 text-orange-600 dark:text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              Appliances & Electronics
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 pl-13">
              List major electronics like air conditioners, refrigerators, or fans. Surcharges will be added to the monthly rent.
            </p>
            <div className="bg-gray-50 dark:bg-gray-900/40 rounded-2xl p-4 sm:p-6 border border-gray-100 dark:border-gray-700/50">
              <ApplianceInput
                appliances={appliances}
                onChange={setAppliances}
                defaultSurcharge={100}
                showTotal={true}
              />
            </div>

            {/* Appliance Surcharge in Deposits Checkbox */}
            {appliances.length > 0 && (
              <div className="mt-6 p-4 bg-amber-50 dark:bg-amber-900/10 rounded-xl border border-amber-200 dark:border-amber-800/30">
                <label className="flex items-start gap-3 cursor-pointer group">
                  <div className="relative flex items-center justify-center mt-0.5">
                    <input
                      type="checkbox"
                      checked={includeApplianceSurchargeInDeposits}
                      onChange={(e) => setIncludeApplianceSurchargeInDeposits(e.target.checked)}
                      className="peer w-5 h-5 opacity-0 absolute cursor-pointer"
                    />
                    <div className={`w-5 h-5 rounded-md border-2 transition-all flex items-center justify-center ${
                      includeApplianceSurchargeInDeposits
                        ? 'bg-orange-500 border-orange-500'
                        : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700'
                    }`}>
                      {includeApplianceSurchargeInDeposits && (
                        <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="font-bold text-gray-900 dark:text-white text-sm">
                      Include appliance surcharges in advance and deposit payments
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-400 mt-1 leading-relaxed">
                      {includeApplianceSurchargeInDeposits ? (
                        <>
                          <span className="font-semibold text-orange-700 dark:text-orange-400">Checked:</span> Advance and deposit will be calculated as
                          <span className="font-bold"> ₱{totalRent.toLocaleString()}</span>
                          {batchMode && selectedRooms.length > 1 && <span> × {selectedRooms.length} rooms</span>}
                          {' '}(base rent + appliance surcharge).
                        </>
                      ) : (
                        <>
                          <span className="font-semibold text-gray-700 dark:text-gray-400">Unchecked:</span> Advance and deposit will be calculated as
                          <span className="font-bold"> ₱{baseRent.toLocaleString()}</span>
                          {batchMode && selectedRooms.length > 1 && <span> × {selectedRooms.length} rooms</span>}
                          {' '}(base rent only). Monthly rent will still include appliance surcharge.
                        </>
                      )}
                    </div>
                  </div>
                </label>
              </div>
            )}
          </div>

          {/* Additional Occupants Section */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-6 sm:p-8 border border-gray-100 dark:border-gray-700">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/40 rounded-xl flex items-center justify-center">
                  <svg className="w-6 h-6 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                </div>
                Additional Occupants
              </h2>
              <button
                type="button"
                onClick={() => setOtherOccupants([...otherOccupants, { full_name: '', relationship: '', phone: '', id_photo: null }])}
                className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 rounded-xl hover:bg-indigo-100 dark:hover:bg-indigo-900/50 text-sm font-bold transition-all shadow-sm border border-indigo-100 dark:border-indigo-800/30"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                </svg>
                Add Person
              </button>
            </div>

            {otherOccupants.length > 0 ? (
              <div className="space-y-4">
                {otherOccupants.map((occ, i) => (
                  <div key={i} className="group relative bg-gray-50 dark:bg-gray-900/40 p-5 rounded-2xl border border-gray-200 dark:border-gray-700 transition-all hover:bg-white dark:hover:bg-gray-800 hover:shadow-md hover:border-indigo-200 dark:hover:border-indigo-900/50">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Full Name</label>
                        <input
                          type="text"
                          value={occ.full_name || occ.name || ''}
                          onChange={e => {
                            const copy = [...otherOccupants];
                            copy[i] = { ...copy[i], full_name: e.target.value };
                            setOtherOccupants(copy);
                          }}
                          className="w-full bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none"
                          placeholder="Name of occupant"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Relationship</label>
                        <input
                          type="text"
                          value={occ.relationship || occ.relation || ''}
                          onChange={e => {
                            const copy = [...otherOccupants];
                            copy[i] = { ...copy[i], relationship: e.target.value };
                            setOtherOccupants(copy);
                          }}
                          className="w-full bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none"
                          placeholder="e.g. Spouse, Child"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Contact (Optional)</label>
                        <input
                          type="text"
                          value={occ.phone || ''}
                          onChange={e => {
                            const copy = [...otherOccupants];
                            copy[i] = { ...copy[i], phone: e.target.value };
                            setOtherOccupants(copy);
                          }}
                          className="w-full bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none"
                          placeholder="Phone number"
                        />
                      </div>
                    </div>

                    {/* Occupant ID Photo Upload */}
                    <div className="mt-4">
                      <label className="block text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Valid ID Photo</label>
                      <div className="flex items-center gap-4">
                        <div className="flex-shrink-0">
                          {occ.id_photo ? (
                            <div className="relative group/photo">
                              <img
                                src={URL.createObjectURL(occ.id_photo)}
                                alt={`ID of ${occ.full_name || occ.name || 'Occupant'}`}
                                className="w-16 h-16 object-cover rounded-xl border-2 border-indigo-400 shadow-sm"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const copy = [...otherOccupants];
                                  copy[i] = { ...copy[i], id_photo: null };
                                  setOtherOccupants(copy);
                                }}
                                className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full p-0.5 shadow-md hover:bg-red-600 transition-colors"
                              >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                          ) : (
                            <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 flex flex-col items-center justify-center text-gray-400">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                            </div>
                          )}
                        </div>
                        <label className="flex-1 cursor-pointer group/upload">
                          <div className="bg-white dark:bg-gray-700/50 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 border border-dashed border-gray-300 dark:border-gray-600 group-hover/upload:border-indigo-400 dark:group-hover/upload:border-indigo-500 rounded-xl px-4 py-3 transition-all text-center">
                            <div className="text-xs font-bold text-gray-600 dark:text-gray-300 group-hover/upload:text-indigo-600 dark:group-hover/upload:text-indigo-400">
                              {occ.id_photo ? 'Change ID Photo' : 'Upload ID Photo'}
                            </div>
                            <div className="text-[10px] text-gray-400 mt-0.5">PNG, JPG up to 10MB</div>
                          </div>
                          <input
                            type="file"
                            onChange={e => {
                              if (e.target.files && e.target.files[0]) {
                                const copy = [...otherOccupants];
                                copy[i] = { ...copy[i], id_photo: e.target.files[0] };
                                setOtherOccupants(copy);
                              }
                            }}
                            className="hidden"
                            accept="image/*"
                          />
                        </label>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setOtherOccupants(otherOccupants.filter((_, idx) => idx !== i))}
                      className="absolute -top-2 -right-2 sm:top-2 sm:right-2 p-1.5 bg-white dark:bg-gray-700 text-gray-400 hover:text-red-500 rounded-lg shadow-sm border border-gray-200 dark:border-gray-600 transition-all hover:scale-110"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-10 bg-gray-50 dark:bg-gray-900/40 rounded-2xl border border-dashed border-gray-300 dark:border-gray-700">
                <svg className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                <p className="text-sm text-gray-500 dark:text-gray-400">No additional occupants listed.</p>
              </div>
            )}
          </div>

          {/* Payment Summary & Form Submission */}
          <div className="sticky bottom-4 z-20 sm:relative sm:bottom-0">
            {(baseRent > 0 || appliances.length > 0 || selectedRooms.length > 0) && (
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl sm:shadow-sm p-5 border border-gray-200 dark:border-gray-700 flex flex-col md:flex-row md:items-center justify-between gap-6 backdrop-blur-md bg-white/95 dark:bg-gray-800/95">
                <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Total Monthly Rent</span>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-2xl font-black text-gray-900 dark:text-white">₱{totalRent.toLocaleString()}</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">/ room</span>
                    </div>
                  </div>

                  <div className="h-10 w-px bg-gray-100 dark:bg-gray-700 hidden md:block"></div>

                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Initial Payment</span>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-2xl font-black text-green-600 dark:text-green-400">₱{initialPayment.toLocaleString()}</span>
                      <span className="text-[10px] bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 px-1.5 py-0.5 rounded font-bold uppercase">Total Due</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 w-full md:w-auto">
                  <button
                    type="button"
                    onClick={onCancel}
                    className="flex-1 md:flex-none px-6 py-3.5 text-gray-700 dark:text-gray-300 font-bold text-sm hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex-1 md:flex-none inline-flex items-center justify-center gap-2 px-8 py-3.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-xl font-bold shadow-lg shadow-blue-500/25 transition-all active:scale-95 text-sm"
                  >
                    {loading ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Creating...
                      </>
                    ) : (
                      <>
                        {batchMode ? `Create ${selectedRooms.length} Tenants` : 'Create Tenant'}
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}

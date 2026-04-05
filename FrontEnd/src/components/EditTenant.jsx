import React, { useState, useEffect } from 'react'
import { authFetch } from '../auth'
import ApplianceInput, { calculateApplianceSurcharge, formatAppliancesForAPI } from './ApplianceInput.jsx'

export default function EditTenant({ tenant, appliances: initialAppliances = [], propertyId, roomNumber, roomSection, roomType, onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    full_name: tenant?.full_name || '',
    email: tenant?.email || '',
    phone: tenant?.phone || '',
    move_in: tenant?.move_in || tenant?.date_of_occupancy || '',
    payment: tenant?.payment ?? tenant?.monthly_rent ?? '',  // Use ?? to preserve 0 as valid value
    payment_day: tenant?.payment_day ?? tenant?.preferred_payment_day ?? '',  // Use ?? and check preferred_payment_day
  })
  const [otherOccupants, setOtherOccupants] = useState(
    tenant?.other_occupants || []
  )
  const [appliances, setAppliances] = useState(
    initialAppliances.map(a => ({ name: a.name, surcharge: Number(a.surcharge_amount || a.surcharge || 0) }))
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  // Capture updated_at for optimistic concurrency check
  const [lastUpdatedAt] = useState(tenant?.updated_at || null)

  // Auto-fill payment day from move-in date if not set
  useEffect(() => {
    if (formData.move_in && !formData.payment_day) {
      const day = new Date(formData.move_in).getDate()
      setFormData(prev => ({ ...prev, payment_day: String(day) }))
    }
  }, [formData.move_in])

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
  }

  const handleOccupantChange = (index, field, value) => {
    const updated = [...otherOccupants]
    updated[index] = { ...updated[index], [field]: value }
    setOtherOccupants(updated)
  }

  const addOccupant = () => {
    setOtherOccupants([...otherOccupants, { full_name: '', relationship: '' }])
  }

  const removeOccupant = (index) => {
    setOtherOccupants(otherOccupants.filter((_, i) => i !== index))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      // Send BASE payment only - backend will calculate total by adding appliance surcharges
      const basePayment = formData.payment ? Number(formData.payment) : 0

      const payload = {
        full_name: formData.full_name,
        email: formData.email,
        phone: formData.phone,
        move_in: formData.move_in || null,
        payment: basePayment,  // Send BASE payment - backend adds appliance surcharges
        payment_day: formData.payment_day ? Number(formData.payment_day) : null,
        other_occupants_count: otherOccupants.length,  // Calculate from array length
        other_occupants: otherOccupants.filter(o => o.full_name && o.relationship),
        appliances: formatAppliancesForAPI(appliances),
        property_id: propertyId,
        room_number: roomNumber,
        room_section: roomSection,
        room_type: roomType,
        updated_at: lastUpdatedAt,
      }

      const response = await authFetch(`/api/tenants/${tenant.tenant_id || tenant.id}/`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      })

      if (response.status === 409) {
        setError('This tenant was modified by another user. Please close and reopen to see the latest data.')
        setLoading(false)
        return
      }

      if (!response.ok) {
        const errorData = await response.json()
        console.error('Validation errors:', errorData)
        const errorMsg = errorData.detail || JSON.stringify(errorData) || 'Failed to update tenant'
        throw new Error(errorMsg)
      }

      const updatedTenant = await response.json()
      const tenantId = updatedTenant.tenant_id || updatedTenant.id || tenant.tenant_id || tenant.id

      // Upload other occupant ID photos if any new ones were added
      for (let i = 0; i < otherOccupants.length; i++) {
        const occ = otherOccupants[i]
        // Only upload if id_photo is a File object (newly selected), not a string URL
        if (occ.id_photo && occ.id_photo instanceof File) {
          try {
            const formData = new FormData()
            formData.append('file', occ.id_photo)
            formData.append('document_type', 'id_photo')
            formData.append('description', `Other Occupant: ${occ.full_name || 'Occupant ' + (i + 1)}${occ.relationship ? ' (' + occ.relationship + ')' : ''}`)

            const uploadRes = await authFetch(`/api/tenants/${tenantId}/documents/upload/`, {
              method: 'POST',
              body: formData,
            })
            if (!uploadRes.ok) {
              console.error(`Failed to upload ID photo for occupant ${i + 1}`)
            }
          } catch (err) {
            console.error(`Failed to upload ID photo for occupant ${i + 1}:`, err)
          }
        }
      }

      if (typeof onSuccess === 'function') {
        // Pass both updated tenant and appliances so the parent can calculate total payment
        onSuccess({ ...updatedTenant, appliances: formatAppliancesForAPI(appliances) })
      }
      if (typeof onClose === 'function') {
        onClose()
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Edit Tenant</h2>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 scrollbar-hide">
          {error && (
            <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded-lg">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Personal Information Section */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Personal Information</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    name="full_name"
                    value={formData.full_name}
                    onChange={handleChange}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Email <span className="text-gray-400 font-normal">(Optional)</span>
                    </label>
                    <input
                      type="email"
                      name="email"
                      value={formData.email}
                      onChange={handleChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Phone <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="tel"
                      name="phone"
                      value={formData.phone}
                      onChange={handleChange}
                      required
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Move-In Date
                  </label>
                  <input
                    type="date"
                    name="move_in"
                    value={formData.move_in}
                    onChange={handleChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  />
                </div>
              </div>
            </div>

            {/* Payment Information Section */}
            <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Payment Information</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Monthly Payment Amount (₱)
                  </label>
                  <input
                    type="number"
                    name="payment"
                    value={formData.payment}
                    onChange={handleChange}
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-base font-semibold text-blue-700 dark:text-blue-400 mb-2">
                    Preferred Payment Day <span className="text-gray-400 font-normal">(Optional)</span>
                  </label>
                  <div className="w-full max-w-xs">
                    <div className="grid grid-cols-7 gap-1 bg-blue-50 dark:bg-gray-700 p-2 rounded-xl border border-blue-200 dark:border-blue-800">
                      {Array.from({ length: 31 }, (_, i) => {
                        const day = i + 1
                        const selected = formData.payment_day == day
                        return (
                          <button
                            key={day}
                            type="button"
                            className={`h-7 w-7 flex items-center justify-center rounded-full font-semibold text-xs transition-all duration-150 border-2 focus:outline-none focus:ring-2 focus:ring-blue-400
                              ${selected ? 'bg-blue-600 text-white border-blue-700 shadow-lg scale-110' : 'bg-white dark:bg-gray-600 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-gray-500 hover:bg-blue-100 dark:hover:bg-gray-500'}`}
                            onClick={() => setFormData(prev => ({ ...prev, payment_day: String(day) }))}
                            aria-label={`Select ${day}${day === 1 || day === 21 || day === 31 ? 'st' : day === 2 || day === 22 ? 'nd' : day === 3 || day === 23 ? 'rd' : 'th'} day`}
                          >
                            {day}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  <p className="text-xs text-blue-700 dark:text-blue-400 mt-2 font-medium">
                    This is the day the tenant prefers to pay rent. If set, this will be followed instead of the default monthly cycle.
                  </p>
                </div>
              </div>
            </div>

            {/* Other Occupants Section */}
            <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Other Occupants</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Total: {otherOccupants.length} occupant{otherOccupants.length !== 1 ? 's' : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={addOccupant}
                  className="px-3 py-1 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                >
                  + Add Occupant
                </button>
              </div>

              {otherOccupants.length > 0 && (
                <div className="space-y-3">
                  {otherOccupants.map((occupant, index) => (
                    <div key={index} className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-900">
                      <div className="flex justify-between items-start mb-3">
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          Occupant {index + 1}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeOccupant(index)}
                          className="text-red-600 hover:text-red-700 text-sm"
                        >
                          Remove
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                            Full Name
                          </label>
                          <input
                            type="text"
                            value={occupant.full_name || ''}
                            onChange={(e) => handleOccupantChange(index, 'full_name', e.target.value)}
                            placeholder="Enter name"
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                            Relationship
                          </label>
                          <input
                            type="text"
                            value={occupant.relationship || ''}
                            onChange={(e) => handleOccupantChange(index, 'relationship', e.target.value)}
                            placeholder="e.g., Spouse, Child"
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                          />
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                            ID Photo (Optional)
                          </label>
                          <label className="cursor-pointer">
                            <div className={`border rounded-md px-3 py-2 transition-colors bg-white dark:bg-gray-800 ${occupant.id_photo
                                ? 'border-green-400 dark:border-green-500 bg-green-50 dark:bg-green-900/20'
                                : 'border-gray-300 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500'
                              }`}>
                              <div className="flex items-center gap-2">
                                {occupant.id_photo ? (
                                  <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                ) : (
                                  <svg className="w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                  </svg>
                                )}
                                <span className={`text-sm ${occupant.id_photo ? 'text-green-700 dark:text-green-400' : 'text-gray-600 dark:text-gray-300'}`}>
                                  {occupant.id_photo
                                    ? (occupant.id_photo instanceof File ? occupant.id_photo.name : 'Photo uploaded')
                                    : 'Choose file'}
                                </span>
                              </div>
                            </div>
                            <input
                              type="file"
                              onChange={(e) => {
                                const file = e.target.files && e.target.files[0] ? e.target.files[0] : null
                                handleOccupantChange(index, 'id_photo', file)
                              }}
                              className="hidden"
                              accept="image/*"
                            />
                          </label>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Appliances Section */}
            <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Appliances</h3>
              <ApplianceInput
                appliances={appliances}
                onChange={setAppliances}
                defaultSurcharge={100}
                showTotal={true}
              />
            </div>
          </form>
        </div>

        {/* Footer with Action Buttons */}
        <div className="p-6 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
          <div className="flex space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800 transition-colors font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              onClick={handleSubmit}
              disabled={loading}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
            >
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

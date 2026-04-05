import React, { useState } from 'react'
import { authFetch } from '../auth'

export default function RemoveTenantModal({ tenant, roomNumber, propertyId, onClose, onSuccess }) {
  const [removeOption, setRemoveOption] = useState('ok_to_rent')
  const [removeReason, setRemoveReason] = useState('')
  const [isRemoving, setIsRemoving] = useState(false)

  // Default refund amounts to tenant's actual advance and deposit amounts
  const [depositRefund, setDepositRefund] = useState(tenant?.deposit_amount || 0)
  const [advanceRefund, setAdvanceRefund] = useState(tenant?.advance_amount || 0)

  const handleRemoveTenant = async () => {
    if (!tenant) return

    setIsRemoving(true)
    try {
      const tenantId = tenant.tenant_id || tenant.id
      const isBlacklisted = removeOption === 'do_not_rent'

      // First update the tenant with blacklist info if needed
      if (isBlacklisted) {
        const updateRes = await authFetch(`/api/tenants/${tenantId}/`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            blacklisted: true,
            blacklist_reason: removeReason || 'Marked as do not rent again upon removal'
          })
        })
        if (!updateRes.ok) {
          throw new Error('Failed to update tenant blacklist status')
        }
      }

      // Then delete: if propertyId + roomNumber provided, remove from this room only (batch rent); otherwise remove from all rooms
      const body = {
        deposit_refund: depositRefund,
        advance_refund: advanceRefund
      }
      if (propertyId != null && roomNumber != null && roomNumber !== '') {
        body.property_id = propertyId
        body.room_number = roomNumber
      }
      const response = await authFetch(`/api/tenants/${tenantId}/`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      })

      if (!response.ok) {
        throw new Error('Failed to remove tenant')
      }

      // Call success callback
      if (typeof onSuccess === 'function') {
        onSuccess()
      }
      onClose()
    } catch (error) {
      alert('Error removing tenant: ' + error.message)
    } finally {
      setIsRemoving(false)
    }
  }

  const tenantName = tenant?.full_name || tenant?.name || 'Tenant'

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-[80] p-4 sm:p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex-shrink-0 bg-gradient-to-r from-red-600 to-red-700 px-6 py-4">
          <h3 className="text-lg font-semibold text-white">Remove Tenant</h3>
          <p className="text-red-100 text-sm">
            Remove {tenantName} {roomNumber ? `from Room ${roomNumber}` : 'from the property'}
          </p>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-6">
          <p className="text-gray-700 mb-4">How would you like to handle this tenant for future rentals?</p>

          <div className="space-y-3 mb-4">
            <label className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors ${removeOption === 'ok_to_rent'
                ? 'border-green-500 bg-green-50'
                : 'border-gray-200 hover:border-gray-300'
              }`}>
              <input
                type="radio"
                name="removeOption"
                value="ok_to_rent"
                checked={removeOption === 'ok_to_rent'}
                onChange={(e) => setRemoveOption(e.target.value)}
                className="mt-1"
              />
              <div>
                <div className="font-medium text-gray-900 flex items-center gap-2">
                  <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  OK to rent again
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  This tenant left in good standing and can be considered for future rentals.
                </p>
              </div>
            </label>

            <label className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors ${removeOption === 'do_not_rent'
                ? 'border-red-500 bg-red-50'
                : 'border-gray-200 hover:border-gray-300'
              }`}>
              <input
                type="radio"
                name="removeOption"
                value="do_not_rent"
                checked={removeOption === 'do_not_rent'}
                onChange={(e) => setRemoveOption(e.target.value)}
                className="mt-1"
              />
              <div>
                <div className="font-medium text-gray-900 flex items-center gap-2">
                  <svg className="w-5 h-5 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M13.477 14.89A6 6 0 015.11 6.524l8.367 8.368zm1.414-1.414L6.524 5.11a6 6 0 018.367 8.367zM18 10a8 8 0 11-16 0 8 8 0 0116 0z" clipRule="evenodd" />
                  </svg>
                  Do NOT rent again
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  This tenant should be blacklisted and not considered for future rentals.
                </p>
              </div>
            </label>
          </div>

          {/* Reason field for blacklist */}
          {removeOption === 'do_not_rent' && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Reason for blacklisting (optional)
              </label>
              <textarea
                value={removeReason}
                onChange={(e) => setRemoveReason(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                rows="3"
                placeholder="e.g., Unpaid rent, property damage, violations..."
              />
            </div>
          )}

          {/* Deposit and Advance Refund */}
          <div className="mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <h4 className="text-sm font-semibold text-gray-700 mb-3">Refund Details</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">
                  Deposit Refund
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">₱</span>
                  <input
                    type="number"
                    value={depositRefund}
                    onChange={(e) => setDepositRefund(parseFloat(e.target.value) || 0)}
                    min="0"
                    step="0.01"
                    className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Original: ₱{(tenant?.deposit_amount || 0).toLocaleString()}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">
                  Advance Refund
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">₱</span>
                  <input
                    type="number"
                    value={advanceRefund}
                    onChange={(e) => setAdvanceRefund(parseFloat(e.target.value) || 0)}
                    min="0"
                    step="0.01"
                    className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Original: ₱{(tenant?.advance_amount || 0).toLocaleString()}
                </p>
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-3">
              Total refund: <span className="font-semibold">₱{(depositRefund + advanceRefund).toLocaleString()}</span>
            </p>
          </div>

          {/* Warning */}
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
            <div className="flex items-center gap-2 text-yellow-700 text-sm">
              <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <span>This will remove the tenant from their current room and mark them as inactive.</span>
            </div>
          </div>
        </div>

        {/* Action Buttons - fixed at bottom so always visible */}
        <div className="flex-shrink-0 flex gap-3 p-6 pt-0 border-t border-gray-100 bg-white">
          <button
            onClick={onClose}
            disabled={isRemoving}
            className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleRemoveTenant}
            disabled={isRemoving}
            className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isRemoving ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Removing...
              </>
            ) : (
              'Confirm Remove'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

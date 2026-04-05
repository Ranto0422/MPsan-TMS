import React, { useEffect, useRef, useState } from 'react'
import RoomSidebar from './RoomSidebar.jsx'
import PaymentConfirmation from './PaymentConfirmation.jsx'
import EditTenant from './EditTenant.jsx'
import TransferTenant from './TransferTenant.jsx'
import { authFetch, getAccess, buildWsUrl } from '../auth.js'
import { isBoxOverdue } from './paymentUtils.js'

// Interactive occupancy floor plan: resizable boxes, selectable room info sidebar, simulated realtime updates
function OccupancyMap({ property, onOpenAddTenant, layoutsRefreshKey, onViewTenantProfile, onPaymentSuccess: parentPaymentSuccess }) {
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
			const sectionPrefix = section.charAt(0).toUpperCase() // F, M, or R
			return `${sectionPrefix}${number}`
		}

		return number
	}

	const containerRef = useRef(null)
	const [boxes, setBoxes] = useState([])
	const [floor, setFloor] = useState(1)

	// per-property saved layouts (persisted in localStorage)
	const [layouts, setLayouts] = useState(() => {
		try { return {} } catch (e) { return {} }
	})
	const [variant, setVariant] = useState('default') // allow different map variants per property
	const [perPropertyFloor, setPerPropertyFloor] = useState(() => { try { return JSON.parse(localStorage.getItem('occLastFloor') || '{}') } catch (e) { return {} } })

	// Grid configuration: 25x25px cells (finer spacing)
	const GRID = 25
	const snap = (v) => Math.round(v / GRID) * GRID
	const snapSize = (s) => Math.max(GRID, Math.round(s / GRID) * GRID)
	// editing mode flag (controls whether layout can be modified)
	const [isEditing, setIsEditing] = useState(false)
	const [savedBoxes, setSavedBoxes] = useState(null)
	const [isSaving, setIsSaving] = useState(false)
	const [pendingFloor, setPendingFloor] = useState(null)
	const [saveStatus, setSaveStatus] = useState('idle') // 'idle'|'saving'|'success'|'error'
	const [history, setHistory] = useState([])
	const actionHistoryPushedRef = React.useRef(false)
	const [menuTargetId, setMenuTargetId] = useState(null)
	const [confirmDeleteId, setConfirmDeleteId] = useState(null)

	const enterEditMode = () => {
		setSavedBoxes(boxes)
		setIsEditing(true)
		setMenuOpen(false)
		setSelectedId(null)
	}

	const saveEdits = async () => {
		setSavedBoxes(boxes)
		setIsEditing(false)
		setMenuOpen(false)
		setSelectedId(null)
		// persist layout for the selected property + variant
		if (property) {
			setIsSaving(true)
			const key = property.propertyName
			const updated = { ...layouts }
			const existingForProp = (updated[key] && updated[key][variant]) ? updated[key][variant] : []
			// Deep clone other floors completely to prevent shared object references
			const otherFloors = existingForProp
				.filter(b => (b.floor || 1) !== floor)
				.map(b => JSON.parse(JSON.stringify(b)))
			// Deep clone boxes completely to avoid shared object references between floors
			const currentFloors = boxes.map(b => ({
				...JSON.parse(JSON.stringify(b)),
				floor: floor
			}))
			const merged = [...otherFloors, ...currentFloors]
			updated[key] = { ...(updated[key] || {}), [variant]: merged }
			setLayouts(updated)
			// persist to backend and await completion so subsequent loads see saved edits
			try {
				setSaveStatus('saving')
				const res = await authFetch(`/api/properties/${property.id}/layouts/`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ layouts: (updated[key] || {}) }),
				})
				if (!res.ok) {
					console.warn('Failed to save layouts', res.status)
					setSaveStatus('error')
				} else {
					setSaveStatus('success')
					setTimeout(() => setSaveStatus('idle'), 3000)
				}
			} catch (e) {
				console.warn('Error saving layouts', e)
				setSaveStatus('error')
			} finally {
				setIsSaving(false)
				if (pendingFloor !== null) {
					const f = pendingFloor
					setPendingFloor(null)
					// apply queued floor change after save
					setFloor(f)
					setSelectedId(null)
					if (property) {
						const key2 = property.propertyName
						const updatedPF = { ...(perPropertyFloor || {}) }
						updatedPF[key2] = f
						setPerPropertyFloor(updatedPF)
						try { localStorage.setItem('occLastFloor', JSON.stringify(updatedPF)) } catch (e) { }
					}
				}
			}
		}
	}

	const exitEdits = () => {
		if (savedBoxes) setBoxes(savedBoxes)
		setSavedBoxes(null)
		setIsEditing(false)
		setMenuOpen(false)
		setSelectedId(null)
	}

	const undoEdit = () => {
		if (savedBoxes) setBoxes(savedBoxes)
		setMenuOpen(false)
	}

	// load layout when property or variant changes; use per-property saved floor
	useEffect(() => {
		let cancelled = false
		if (!property) {
			setBoxes([])
			return
		}
		const key = property.propertyName
		const chosenFloor = perPropertyFloor[key] || 1
		setFloor(chosenFloor)

			; (async () => {
				try {
					const res = await authFetch(`/api/properties/${property.id}/layouts/`)
					if (!res.ok) {
						setLayouts((prev) => ({ ...prev }))
						setBoxes([])
						return
					}
					const data = await res.json()
					// Deep clone layouts to prevent shared object references between floors
					const propLayouts = JSON.parse(JSON.stringify(data.layouts || {}))
					if (cancelled) return
					// merge server result with local cache, preferring server updates over stale local cache
					// Deep clone the entire previous state to prevent any shared references
					setLayouts((prev) => {
						const clonedPrev = JSON.parse(JSON.stringify(prev))
						return { ...clonedPrev, [key]: { ...(clonedPrev[key] || {}), ...propLayouts } }
					})
					const arrAll = propLayouts[variant] || []
					// Deep clone boxes when filtering to prevent shared references
					const arr = arrAll
						.filter(b => (b.floor || 1) === chosenFloor)
						.map(b => JSON.parse(JSON.stringify(b)))
					setBoxes(arr)
					setSelectedId(null)
				} catch (e) {
					setBoxes([])
				}
			})()

		return () => { cancelled = true }
	}, [property, variant, perPropertyFloor, layoutsRefreshKey])

	// WebSocket: subscribe to property layout updates for real-time sync
	useEffect(() => {
		if (!property || !property.id) return
		let ws
		const wsRef = { current: null }
		const currentPropRef = { id: property.id }
		const token = getAccess()
		const qs = token ? `?token=${encodeURIComponent(token)}` : ''
		const url = buildWsUrl(`/ws/properties/${property.id}/${qs}`)
		// delay websocket creation slightly to avoid race when switching properties rapidly
		let connectTimer = setTimeout(() => {
			// ensure this connect attempt is still relevant
			if (currentPropRef.id !== property.id) return
			try {
				ws = new WebSocket(url)
			} catch (e) {
				console.warn('WebSocket failed to connect', e)
				return
			}

			// store current socket reference for cleanup and stale-event detection
			wsRef.current = ws

			ws.onopen = () => {
				console.debug('WS connected to', url)
			}
			ws.onclose = () => {
				console.debug('WS disconnected', url)
			}
			ws.onerror = (err) => {
				console.warn('WS error', err)
			}
			ws.onmessage = (ev) => {
				if (wsRef.current !== ws) return // ignore messages from stale sockets
				try {
					const msg = JSON.parse(ev.data)
					if (msg.type === 'layouts.update') {
						// Deep clone incoming layouts to prevent shared object references
						const incomingLayouts = JSON.parse(JSON.stringify(msg.layouts || {}))
						const key = property.propertyName

						// The backend sends prop.layouts which is the layouts JSONField
						// This should be { variant1: [...], variant2: [...] } structure
						// If it's wrapped in property name, extract it; otherwise use as-is
						const propLayouts = incomingLayouts[key] || incomingLayouts

						// Update layouts state - create new object references to trigger React re-render
						// This ensures a clean data flow: WebSocket → layouts → useEffect → boxes → UI
						setLayouts(prev => ({
							...prev,
							[key]: {
								...(prev[key] || {}),
								...propLayouts
							}
						}))

						console.debug('WebSocket: Received layouts.update', {
							propertyName: key,
							variant,
							layoutsUpdated: true
						})
					}
				} catch (e) { console.warn('Invalid WS message', e) }
			}
		}, 500)



		return () => {
			clearTimeout(connectTimer)
			// mark currentPropRef to different id so pending connect won't proceed
			currentPropRef.id = null
			try { if (wsRef.current) { wsRef.current.close(); wsRef.current = null } } catch (e) { }
		}
	}, [property && property.id, variant])

	// Update boxes when floor changes - use cached layout data for instant floor switching
	useEffect(() => {
		if (!property || isEditing) return
		const key = property.propertyName
		const propLayouts = layouts[key]
		if (propLayouts && propLayouts[variant]) {
			const arrAll = propLayouts[variant] || []
			// Deep clone boxes when filtering to prevent shared references
			const arr = arrAll
				.filter(b => (b.floor || 1) === floor)
				.map(b => JSON.parse(JSON.stringify(b)))
			setBoxes(arr)
		}
	}, [floor, property, variant, layouts, isEditing])

	const [menuOpen, setMenuOpen] = useState(false)
	const [menuPos, setMenuPos] = useState({ x: 0, y: 0 })
	const [actionState, setActionState] = useState(null) // { mode: 'move'|'resize', id, startX, startY, orig }
	const [selectedId, setSelectedId] = useState(null)
	const [selectedIds, setSelectedIds] = useState(new Set()) // multi-select in edit mode
	const [pendingPaymentBox, setPendingPaymentBox] = useState(null) // open payment modal at map level so sidebar can close on small screens
	const [pendingEditBox, setPendingEditBox] = useState(null)
	const [pendingTransferBox, setPendingTransferBox] = useState(null)
	const [selectionRect, setSelectionRect] = useState(null) // { x,y,w,h, startX, startY }
	const [sectionModalOpen, setSectionModalOpen] = useState(false)
	const [sectionTargetId, setSectionTargetId] = useState(null)
	const [editRoomNumber, setEditRoomNumber] = useState('')
	const [editRoomSection, setEditRoomSection] = useState('')

	// Default fallback box (used rarely) - room default is 1x2, commercial default is 2x2
	const DEFAULT_BOX = { w: GRID * 1, h: GRID * 2 }


	const clampToBounds = (x, y, w, h) => {
		const el = containerRef.current
		if (!el) return { x, y }
		const rect = el.getBoundingClientRect()
		const maxX = Math.max(0, rect.width - w)
		const maxY = Math.max(0, rect.height - h)
		return {
			x: Math.min(Math.max(0, x), maxX),
			y: Math.min(Math.max(0, y), maxY),
		}
	}

	const handleContextMenu = (e) => {
		if (!isEditing) return
		e.preventDefault()
		const el = containerRef.current
		if (!el) return
		const rect = el.getBoundingClientRect()
		const x = e.clientX - rect.left
		const y = e.clientY - rect.top
		setMenuPos({ x, y })
		setMenuTargetId(null)
		setMenuOpen(true)
	}

	const addBox = (type, pos) => {
		// record history for undo
		if (isEditing) setHistory((h) => [boxes, ...h].slice(0, 50))
		// default sizes by type (in grid units)
		const size = type === 'commercial' ? { w: GRID * 2, h: GRID * 2 } : { w: GRID * 1, h: GRID * 2 }
		// use provided pos or fall back to menuPos
		const position = pos || menuPos
		// snap to grid then clamp
		const snapped = clampToBounds(snap(position.x), snap(position.y), size.w, size.h)
		const { x, y } = snapped
		// generate next number for this type
		const nextNumber = (() => {
			const nums = boxes.filter(b => b.type === type).map(b => Number(b.number) || 0)
			const max = nums.length ? Math.max(...nums) : 0
			return max + 1
		})()
		setBoxes((prev) => [
			...prev,
			{
				id: Date.now(),
				x,
				y,
				w: size.w,
				h: size.h,
				type,
				number: String(nextNumber),
				occupancy: 0,
				capacity: Math.floor(Math.random() * 4) + 1,
				status: 'available',
				floor: floor,
				rotation: 0,
			},
		])
		setMenuOpen(false)
	}

	const duplicateBox = (id) => {
		if (!isEditing) return
		const b = boxes.find(x => x.id === id)
		if (!b) return
		const offset = GRID
		const clamped = clampToBounds(b.x + offset, b.y + offset, b.w, b.h)
		const newBox = { ...b, id: Date.now(), x: clamped.x, y: clamped.y }
		setBoxes((prev) => [...prev, newBox])
		setMenuOpen(false)
	}

	const longPressTimerRef = React.useRef(null)

	// container pointer down — supports both mouse and touch/stylus
	const handleContainerPointerDown = (e) => {
		if (!isEditing) return
		// for mouse, only handle left button
		if (e.pointerType === 'mouse' && e.button !== 0) return
		// don't start rect if clicking on a box (boxes stopPropagation on pointerdown)
		const el = containerRef.current
		if (!el) return
		const rect = el.getBoundingClientRect()
		const startX = e.clientX - rect.left
		const startY = e.clientY - rect.top

		// Long-press on touch/stylus → show context menu at press position
		if (e.pointerType !== 'mouse') {
			if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current)
			longPressTimerRef.current = setTimeout(() => {
				longPressTimerRef.current = null
				setMenuPos({ x: startX, y: startY })
				setMenuTargetId(null)
				setMenuOpen(true)
			}, 500)
		}

		setSelectionRect({ startX, startY, x: startX, y: startY, w: 0, h: 0 })
		setSelectedId(null)
		// clear multi-selection when clicking on empty space
		setSelectedIds(new Set())
	}

	// helper: add a box at canvas center (for toolbar button usage)
	const addBoxAtCenter = (type) => {
		const el = containerRef.current
		const cx = el ? el.clientWidth / 2 : 200
		const cy = el ? el.clientHeight / 2 : 200
		addBox(type, { x: cx, y: cy })
	}

	const onBoxPointerDown = (e, box) => {
		if (!isEditing) return
		// cancel any pending long-press on the container
		if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null }
		// multi-select support: ctrl/cmd to toggle selection
		const multiKey = e.ctrlKey || e.metaKey
		// compute new selection synchronously
		let newSelection = new Set(selectedIds)
		if (multiKey) {
			if (newSelection.has(box.id)) newSelection.delete(box.id)
			else newSelection.add(box.id)
		} else {
			// if not multi-key but this box is already selected, keep the full selection
			if (!selectedIds.has(box.id)) {
				newSelection = new Set([box.id])
			}
		}
		setSelectedIds(newSelection)
		// push one history snapshot at drag start
		if (!actionHistoryPushedRef.current) {
			setHistory((h) => [boxes, ...h].slice(0, 50))
			actionHistoryPushedRef.current = true
		}
		e.stopPropagation()
		e.preventDefault()
		setMenuOpen(false)
		setSelectedId(box.id)
		// start move; if multiple selected and this box is part of selection, move all
		if (newSelection.size > 1 && newSelection.has(box.id)) {
			const origPositions = {}
			Array.from(newSelection).forEach(id => {
				const b = boxes.find(x => x.id === id)
				if (b) origPositions[id] = { x: b.x, y: b.y, w: b.w, h: b.h }
			})
			setActionState({ mode: 'move', id: box.id, startX: e.clientX, startY: e.clientY, multi: true, origPositions })
		} else {
			setActionState({ mode: 'move', id: box.id, startX: e.clientX, startY: e.clientY, orig: { x: box.x, y: box.y, w: box.w, h: box.h } })
		}
	}

	const onResizeHandleDown = (e, box, corner = 'br') => {
		if (!isEditing) return
		if (!actionHistoryPushedRef.current) {
			setHistory((h) => [boxes, ...h].slice(0, 50))
			actionHistoryPushedRef.current = true
		}
		e.stopPropagation()
		e.preventDefault()
		setMenuOpen(false)
		setSelectedId(box.id)
		setActionState({ mode: 'resize', id: box.id, startX: e.clientX, startY: e.clientY, orig: { x: box.x, y: box.y, w: box.w, h: box.h, corner } })
	}

	useEffect(() => {
		if (!actionState) return

		const onMove = (e) => {
			if (!actionState) return
			// cancel long-press if finger moves while dragging
			if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null }
			const el = containerRef.current
			if (!el) return

			if (actionState.mode === 'move') {
				const dx = e.clientX - actionState.startX
				const dy = e.clientY - actionState.startY
				if (actionState.multi && actionState.origPositions) {
					// move all selected boxes relative to their original positions
					setBoxes((prev) => prev.map((b) => {
						if (!actionState.origPositions[b.id]) return b
						const orig = actionState.origPositions[b.id]
						const rawX = orig.x + dx
						const rawY = orig.y + dy
						const x = clampToBounds(snap(rawX), snap(rawY), orig.w || DEFAULT_BOX.w, orig.h || DEFAULT_BOX.h).x
						const y = clampToBounds(snap(rawX), snap(rawY), orig.w || DEFAULT_BOX.w, orig.h || DEFAULT_BOX.h).y
						return { ...b, x, y }
					}))
				} else {
					const rawX = actionState.orig.x + dx
					const rawY = actionState.orig.y + dy
					const snapX = snap(rawX)
					const snapY = snap(rawY)
					const { x, y } = clampToBounds(snapX, snapY, actionState.orig.w || DEFAULT_BOX.w, actionState.orig.h || DEFAULT_BOX.h)
					setBoxes((prev) => prev.map((b) => (b.id === actionState.id ? { ...b, x, y } : b)))
				}
			} else if (actionState.mode === 'resize') {
				const dx = e.clientX - actionState.startX
				const dy = e.clientY - actionState.startY
				setBoxes((prev) => prev.map((b) => {
					if (b.id !== actionState.id) return b
					let newW = actionState.orig.w + dx
					let newH = actionState.orig.h + dy
					// snap sizes to grid and enforce minimum
					newW = snapSize(newW)
					newH = snapSize(newH)
					// ensure within container
					const clamped = clampToBounds(b.x, b.y, newW, newH)
					return { ...b, w: newW, h: newH, x: clamped.x, y: clamped.y }
				}))
			}
		}

		const onUp = () => {
			setActionState(null)
			actionHistoryPushedRef.current = false
		}

		window.addEventListener('pointermove', onMove)
		window.addEventListener('pointerup', onUp)
		return () => {
			window.removeEventListener('pointermove', onMove)
			window.removeEventListener('pointerup', onUp)
		}
	}, [actionState])

	// Close menu on outside click/tap
	useEffect(() => {
		if (!menuOpen) return
		const onDown = (e) => {
			const menu = document.getElementById('occ-map-menu')
			if (menu && !menu.contains(e.target)) setMenuOpen(false)
		}
		window.addEventListener('pointerdown', onDown)
		return () => window.removeEventListener('pointerdown', onDown)
	}, [menuOpen])

	// selection rectangle handlers
	useEffect(() => {
		if (!selectionRect) return
		const onMove = (e) => {
			const el = containerRef.current
			if (!el) return
			const rect = el.getBoundingClientRect()
			const x = Math.min(selectionRect.startX, e.clientX - rect.left)
			const y = Math.min(selectionRect.startY, e.clientY - rect.top)
			const w = Math.abs(e.clientX - rect.left - selectionRect.startX)
			const h = Math.abs(e.clientY - rect.top - selectionRect.startY)
			setSelectionRect(prev => ({ ...prev, x, y, w, h }))
		}
		const onUp = (e) => {
			if (!selectionRect) return
			// finalize selection
			const sel = []
			boxes.filter(b => b.floor === floor).forEach(b => {
				const bx = b.x, by = b.y, bw = b.w, bh = b.h
				const rx = selectionRect.x, ry = selectionRect.y, rw = selectionRect.w, rh = selectionRect.h
				if (bx < rx + rw && bx + bw > rx && by < ry + rh && by + bh > ry) sel.push(b.id)
			})
			setSelectedIds(new Set(sel))
			setSelectionRect(null)
		}
		window.addEventListener('pointermove', onMove)
		window.addEventListener('pointerup', onUp)
		return () => {
			window.removeEventListener('pointermove', onMove)
			window.removeEventListener('pointerup', onUp)
		}
	}, [selectionRect, boxes, floor])



	const saveBoxEdits = (id, data) => {
		if (isEditing) setHistory((h) => [boxes, ...h].slice(0, 50))
		setBoxes((prev) => prev.map(b => b.id === id ? { ...b, ...data } : b))
	}



	const undo = () => {
		setHistory((h) => {
			if (!h || h.length === 0) return h
			const [prev, ...rest] = h
			setBoxes(prev)
			return rest
		})
		setMenuOpen(false)
	}

	const rotateBox = (id, degrees) => {
		if (!isEditing) return
		setHistory((h) => [boxes, ...h].slice(0, 50))
		setBoxes((prev) => prev.map(b => {
			if (b.id === id) {
				const newRotation = ((b.rotation || 0) + degrees) % 360
				return { ...b, rotation: newRotation }
			}
			return b
		}))
	}

	const setSectionForRoom = (id, section) => {
		if (!isEditing) return
		setHistory((h) => [boxes, ...h].slice(0, 50))
		setBoxes((prev) => prev.map(b => b.id === id ? { ...b, section } : b))
		setSectionModalOpen(false)
		setSectionTargetId(null)
		setMenuOpen(false)
	}

	const deleteBox = (id) => {
		// Check if any rooms to be deleted have tenants
		const roomsToDelete = selectedIds.size > 1
			? boxes.filter(b => selectedIds.has(b.id))
			: boxes.filter(b => b.id === id)

		const occupiedRooms = roomsToDelete.filter(b => b.status === 'occupied' || b.tenant)

		if (occupiedRooms.length > 0) {
			const roomNumbers = occupiedRooms.map(r => r.number || r.id).join(', ')
			alert(`Cannot delete room(s) with active tenants. Please remove the tenant(s) first.\n\nOccupied room(s): ${roomNumbers}`)
			setMenuOpen(false)
			setConfirmDeleteId(null)
			return
		}

		if (isEditing) setHistory((h) => [boxes, ...h].slice(0, 50))
		// If multiple boxes are selected, delete all of them
		if (selectedIds.size > 1) {
			setBoxes((prev) => prev.filter(b => !selectedIds.has(b.id)))
			setSelectedIds(new Set())
		} else {
			// Single box deletion
			setBoxes((prev) => prev.filter(b => b.id !== id))
		}
		setMenuOpen(false)
		setMenuTargetId(null)
		setConfirmDeleteId(null)
		if (selectedId === id) setSelectedId(null)
	}

	const selectedBox = boxes.find(b => b.id === selectedId)

	// Sync edit values when selectedBox changes
	useEffect(() => {
		if (selectedBox && isEditing) {
			setEditRoomNumber(selectedBox.number || '')
			setEditRoomSection(selectedBox.section || '')
		} else {
			setEditRoomNumber('')
			setEditRoomSection('')
		}
	}, [selectedBox, isEditing])

	const applyRoomEdits = () => {
		if (!selectedId || !isEditing) return
		setHistory((h) => [boxes, ...h].slice(0, 50))
		setBoxes((prev) => prev.map(b =>
			b.id === selectedId
				? { ...b, number: editRoomNumber, section: editRoomSection }
				: b
		))
	}

	// If no property selected, show a clear placeholder and do not render the interactive map
	if (!property) {
		return (
			<div className="w-full min-h-[480px] h-full flex items-center justify-center">
				<div className="p-6 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md text-center">
					<div className="text-lg font-semibold">No property selected</div>
					<div className="text-sm text-gray-500 mt-2">Select a property from the list to view and edit its occupancy map.</div>
				</div>
			</div>
		)
	}

	return (
		<div className="w-full min-h-[480px] h-full space-y-3">
			{/* Toolbar */}
			<div className="flex flex-wrap items-center gap-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3 shadow-sm">
				{/* Left: Floor Selector */}
				<div className="flex items-center space-x-2">
					<span className="text-sm font-medium text-gray-700 dark:text-gray-300">Floor:</span>
					<div className="flex space-x-1">
						{Array.from({ length: property.floors || 1 }, (_, i) => i + 1).map((f) => (
							<button
								key={f}
								onClick={() => {
									if (isSaving) {
										setPendingFloor(f)
										return
									}
									setFloor(f);
									setSelectedId(null);
									if (property) {
										const key = property.propertyName
										const updated = { ...(perPropertyFloor || {}) }
										updated[key] = f
										setPerPropertyFloor(updated)
										try { localStorage.setItem('occLastFloor', JSON.stringify(updated)) } catch (e) { }
									}
								}}
								className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${floor === f
									? 'bg-blue-600 text-white shadow-sm'
									: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
									}`}
							>
								{f}
							</button>
						))}
					</div>
				</div>

				{/* Center: Status Legend */}
				<div className="hidden lg:flex items-center space-x-4 text-xs flex-shrink-0">
					<div className="flex items-center space-x-1.5">
						<span className="w-3 h-3 bg-gray-400 rounded-full"></span>
						<span className="text-gray-600 dark:text-gray-400">Vacant</span>
					</div>
					<div className="flex items-center space-x-1.5">
						<span className="w-3 h-3 bg-green-500 rounded-full"></span>
						<span className="text-gray-600 dark:text-gray-400">Occupied</span>
					</div>
					<div className="flex items-center space-x-1.5">
						<span className="w-3 h-3 bg-yellow-500 rounded-full"></span>
						<span className="text-gray-600 dark:text-gray-400">Maintenance</span>
					</div>
					<div className="flex items-center space-x-1.5">
						<span className="w-3 h-3 bg-red-500 rounded-full"></span>
						<span className="text-gray-600 dark:text-gray-400">Overdue</span>
					</div>
				</div>

				{/* Right: Action Buttons */}
				<div className="flex flex-wrap items-center gap-2 ml-auto">
					{property?.is_archived && (
						<span className="px-3 py-1.5 text-xs font-medium rounded-md bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 flex items-center space-x-1.5">
							<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
							</svg>
							<span>Archived</span>
						</span>
					)}
					{!isEditing ? (
						!property?.is_archived && (
							<button
								onClick={enterEditMode}
								className="px-3 md:px-4 py-2 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors flex items-center space-x-2"
							>
								<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
								</svg>
								<span className="hidden sm:inline">Edit Layout</span>
							</button>
						)
					) : (
						<>
							<button
								onClick={saveEdits}
								className="px-3 md:px-4 py-2 text-sm font-medium rounded-md bg-green-600 text-white hover:bg-green-700 transition-colors flex items-center space-x-2"
							>
								<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
								</svg>
								<span className="hidden sm:inline">Save</span>
							</button>
							{saveStatus === 'saving' && <span className="text-xs text-gray-600 dark:text-gray-400 animate-pulse">Saving...</span>}
							{saveStatus === 'success' && (
								<span className="text-xs text-green-600 dark:text-green-400 flex items-center space-x-1">
									<svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
										<path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
									</svg>
									<span className="hidden sm:inline">Saved!</span>
								</span>
							)}
							{saveStatus === 'error' && <span className="text-xs text-red-600 dark:text-red-400">Failed</span>}
							<button
								onClick={() => addBoxAtCenter('room')}
								className="px-2 md:px-3 py-2 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
								title="Add Room"
							>
								<span className="hidden sm:inline">+ Room</span>
								<span className="sm:hidden">+R</span>
							</button>
							<button
								onClick={() => addBoxAtCenter('commercial')}
								className="px-2 md:px-3 py-2 text-sm font-medium rounded-md bg-purple-600 text-white hover:bg-purple-700 transition-colors"
								title="Add Commercial"
							>
								<span className="hidden sm:inline">+ Commercial</span>
								<span className="sm:hidden">+C</span>
							</button>
							<button
								onClick={undo}
								className="px-2 md:px-3 py-2 text-sm font-medium rounded-md bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
								title="Undo"
							>
								<span className="hidden sm:inline">Undo</span>
								<span className="sm:hidden">↶</span>
							</button>
							<button
								onClick={exitEdits}
								className="px-2 md:px-3 py-2 text-sm font-medium rounded-md bg-red-500 text-white hover:bg-red-600 transition-colors"
								title="Cancel"
							>
								<span className="hidden sm:inline">Cancel</span>
								<span className="sm:hidden">✕</span>
							</button>
						</>
					)}
				</div>
			</div>

			{/* Edit Panel - Shows when room is selected in edit mode */}
			{isEditing && selectedBox && (
				<div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3 shadow-sm">
					<div className="flex items-center justify-between mb-3">
						<div className="text-sm font-semibold text-gray-700 dark:text-gray-300">Edit Room Details</div>
						<button
							onClick={() => setSelectedId(null)}
							className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
						>
							<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
							</svg>
						</button>
					</div>
					<div className="grid grid-cols-1 md:grid-cols-3 gap-3">
						{/* Room Number Input */}
						<div className="flex flex-col">
							<label className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Room Number</label>
							<input
								type="text"
								value={editRoomNumber}
								onChange={(e) => setEditRoomNumber(e.target.value)}
								onKeyDown={(e) => { if (e.key === 'Enter') applyRoomEdits() }}
								className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
								placeholder="e.g., 1, 2A, 101"
							/>
						</div>
						{/* Section Dropdown */}
						<div className="flex flex-col">
							<label className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Section</label>
							<select
								value={editRoomSection}
								onChange={(e) => setEditRoomSection(e.target.value)}
								className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
							>
								<option value="">None</option>
								<option value="upper">Upper</option>
								<option value="front">Front</option>
								<option value="middle">Middle</option>
								<option value="rear">Rear</option>
							</select>
						</div>
						{/* Apply Button */}
						<div className="flex items-end">
							<button
								onClick={applyRoomEdits}
								className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium transition-colors flex items-center justify-center space-x-2"
							>
								<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
								</svg>
								<span>Apply Changes</span>
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Map Container */}
			<div
				ref={containerRef}
				onContextMenu={handleContextMenu}
				onPointerDown={handleContainerPointerDown}
				className="relative w-full h-[600px] md:h-[720px] bg-gray-50 dark:bg-gray-900 rounded-lg border-2 border-gray-200 dark:border-gray-700 overflow-hidden shadow-inner"
				style={{
					backgroundImage: `linear-gradient(to right, rgba(0,0,0,0.03) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,0.03) 1px, transparent 1px)`,
					backgroundSize: `${GRID}px ${GRID}px`,
					touchAction: isEditing ? "none" : "auto",
				}}
			>
				{/* Boxes */}
				{boxes.filter(b => b.floor === floor).map((b) => {
					const percent = b.capacity > 0 ? Math.round((b.occupancy / b.capacity) * 100) : 0
					// Determine state color: maintenance->yellow, overdue->red, occupied->green, vacant->grey
					const overdue = isBoxOverdue(b)
					let stateBg, textColor
					if (b.status === 'maintenance') {
						stateBg = 'bg-yellow-100 dark:bg-yellow-700/60 border-yellow-400 dark:border-yellow-500'
						textColor = 'text-yellow-900 dark:text-yellow-100'
					} else if (overdue) {
						stateBg = 'bg-red-100 dark:bg-red-700/60 border-red-400 dark:border-red-500'
						textColor = 'text-red-900 dark:text-red-100'
					} else if (b.status === 'occupied' || b.occupancy >= b.capacity) {
						stateBg = 'bg-green-100 dark:bg-green-700/60 border-green-400 dark:border-green-500'
						textColor = 'text-green-900 dark:text-green-100'
					} else {
						stateBg = 'bg-gray-100 dark:bg-gray-600/70 border-gray-300 dark:border-gray-500'
						textColor = 'text-gray-700 dark:text-gray-100'
					}

					return (
						<div
							key={b.id}
							onClick={(e) => {
								e.stopPropagation();
								// In edit mode, clicking selects the room for editing
								// In view mode, opens the sidebar
								setSelectedId(b.id)
							}}
							onContextMenu={(e) => {
								if (!isEditing) return
								e.stopPropagation()
								e.preventDefault()
								const rect = containerRef.current?.getBoundingClientRect()
								if (!rect) return							// Don't change selection if right-clicking on an already-selected box
								if (!selectedIds.has(b.id)) {
									setSelectedIds(new Set([b.id]))
								} setMenuPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
								setMenuTargetId(b.id)
								setMenuOpen(true)
							}}
							className={`absolute border-2 rounded-lg shadow-md select-none hover:shadow-lg transition-all ${stateBg} ${selectedIds.has(b.id) ? 'ring-4 ring-blue-400 border-blue-600 scale-105' :
								(isEditing && selectedId === b.id) ? 'ring-4 ring-green-400 border-green-600' :
									''
								} ${!isEditing ? 'hover:scale-105 cursor-pointer' : 'cursor-pointer'}`}
							style={{
								left: b.x,
								top: b.y,
								width: b.w,
								height: b.h,
								transform: `rotate(${b.rotation || 0}deg)`,
								transformOrigin: 'center center'
							}}
						>
							<div
								onPointerDown={(e) => onBoxPointerDown(e, b)}
								className={`h-full w-full flex items-center justify-center ${isEditing ? 'cursor-move' : 'cursor-pointer'}`}
								title={isEditing ? 'Drag to move' : formatRoomDisplay(b)}
							>
								<div
									className={`text-xs font-bold ${textColor} text-center`}
									style={{
										transform: `rotate(${-(b.rotation || 0)}deg)`,
										transformOrigin: 'center center'
									}}
								>
									{formatRoomDisplay(b)}
								</div>
							</div>

							{/* resize handle bottom-right (only visible in edit mode) */}
							{isEditing && (
								<div
									onPointerDown={(e) => onResizeHandleDown(e, b, 'br')}
									className="absolute right-0 bottom-0 w-4 h-4 bg-blue-500 rounded-tl-md shadow-sm hover:bg-blue-600 cursor-se-resize z-30 transition-colors"
									style={{ transform: 'translate(50%, 50%)' }}
									title="Drag to resize"
								/>
							)}
						</div>
					)
				})}

				{selectionRect && (
					<div className="absolute bg-blue-300 opacity-30 border-2 border-blue-500 rounded" style={{ left: selectionRect.x, top: selectionRect.y, width: selectionRect.w, height: selectionRect.h }} />
				)}

				{/* Right-click context menu */}
				{menuOpen && (
					<div
						id="occ-map-menu"
						className="absolute z-50 w-52 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-2xl"
						style={{ left: menuPos.x, top: menuPos.y }}
						onMouseDown={(e) => e.stopPropagation()}
					>
						{menuTargetId ? (
							<div className="p-2">
								{confirmDeleteId === menuTargetId ? (
									<div className="space-y-3 p-2">
										<div className="text-sm text-gray-700 dark:text-gray-300">
											{selectedIds.size > 1 ? `Delete ${selectedIds.size} selected rooms?` : 'Delete this room?'}
										</div>
										<div className="flex space-x-2">
											<button onClick={(e) => { e.stopPropagation(); deleteBox(menuTargetId); }} className="flex-1 px-3 py-2 bg-red-600 text-white rounded-md text-sm font-medium hover:bg-red-700 transition-colors">Delete</button>
											<button onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }} className="flex-1 px-3 py-2 bg-gray-200 dark:bg-gray-700 rounded-md text-sm font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors">Cancel</button>
										</div>
									</div>
								) : (
									<div className="py-1">
										<button onClick={(e) => { e.stopPropagation(); duplicateBox(menuTargetId); }} className="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">Duplicate Room</button>
										<button onClick={(e) => { e.stopPropagation(); setSectionTargetId(menuTargetId); setSectionModalOpen(true); setMenuOpen(false); }} className="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">Set Section</button>
										<div className="px-3 py-2 border-t border-gray-200 dark:border-gray-700">
											<div className="text-xs text-gray-500 dark:text-gray-400 mb-2">Rotate</div>
											<div className="flex space-x-2">
												<button onClick={() => { rotateBox(menuTargetId, -90); setMenuOpen(false); }} className="flex-1 px-2 py-1.5 bg-gray-100 dark:bg-gray-700 rounded text-xs hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors flex items-center justify-center space-x-1">
													<svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
														<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
													</svg>
													<span>90°</span>
												</button>
												<button onClick={() => { rotateBox(menuTargetId, 90); setMenuOpen(false); }} className="flex-1 px-2 py-1.5 bg-gray-100 dark:bg-gray-700 rounded text-xs hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors flex items-center justify-center space-x-1">
													<svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
														<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" />
													</svg>
													<span>90°</span>
												</button>
											</div>
										</div>
										<button onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(menuTargetId); }} className="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 transition-colors">Delete Room</button>
									</div>
								)}
							</div>
						) : (
							<>
								<div className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700">
									Add new room
								</div>
								<ul className="p-2">
									<li>
										<button
											onClick={() => addBox('room')}
											className="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors flex items-center space-x-2"
										>
											<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
											</svg>
											<span>Room</span>
										</button>
									</li>
									<li>
										<button
											onClick={() => addBox('commercial')}
											className="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors flex items-center space-x-2"
										>
											<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
											</svg>
											<span>Commercial</span>
										</button>
									</li>
								</ul>
							</>
						)}
					</div>
				)}

				{/* Right-side room sidebar removed from map container; will render as fixed overlay to the right */}
			</div>

			{/* Hint Text */}
			{isEditing && (
				<div className="flex items-center justify-center space-x-4 text-xs text-gray-500 dark:text-gray-400 bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 rounded-lg px-4 py-2">
					<div className="flex items-center space-x-1">
						<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
						</svg>
						<span className="hidden md:inline">Right-click</span><span className="md:hidden">Long-press</span><span> to add room</span>
					</div>
					<div className="flex items-center space-x-1">
						<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11" />
						</svg>
						<span>Drag to move</span>
					</div>
					<div className="flex items-center space-x-1">
						<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
						</svg>
						<span>Corner handle to resize</span>
					</div>
				</div>
			)}

			{/* Section Modal */}
			{sectionModalOpen && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50" onClick={() => { setSectionModalOpen(false); setSectionTargetId(null); }}>
					<div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 max-w-sm w-full mx-4" onClick={(e) => e.stopPropagation()}>
						<h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">Set Room Section</h3>
						<div className="text-sm text-gray-600 dark:text-gray-400 mb-4">
							Choose which section of the property this room belongs to:
						</div>
						<div className="space-y-2">
							<button
								onClick={() => setSectionForRoom(sectionTargetId, 'upper')}
								className="w-full px-4 py-3 bg-indigo-500 hover:bg-indigo-600 text-white rounded-md transition-colors flex items-center justify-center space-x-2"
							>
								<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 10l7-7m0 0l7 7m-7-7v18" />
								</svg>
								<span>Upper</span>
							</button>
							<button
								onClick={() => setSectionForRoom(sectionTargetId, 'front')}
								className="w-full px-4 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-md transition-colors flex items-center justify-center space-x-2"
							>
								<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7l5 5m0 0l-5 5m5-5H6" />
								</svg>
								<span>Front</span>
							</button>
							<button
								onClick={() => setSectionForRoom(sectionTargetId, 'middle')}
								className="w-full px-4 py-3 bg-purple-500 hover:bg-purple-600 text-white rounded-md transition-colors flex items-center justify-center space-x-2"
							>
								<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
								</svg>
								<span>Middle</span>
							</button>
							<button
								onClick={() => setSectionForRoom(sectionTargetId, 'rear')}
								className="w-full px-4 py-3 bg-green-500 hover:bg-green-600 text-white rounded-md transition-colors flex items-center justify-center space-x-2"
							>
								<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 17l-5-5m0 0l5-5m-5 5h12" />
								</svg>
								<span>Rear</span>
							</button>
							<button
								onClick={() => { setSectionModalOpen(false); setSectionTargetId(null); }}
								className="w-full px-4 py-3 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-white rounded-md transition-colors"
							>
								Cancel
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Payment modal at map level so sidebar can close on small screens */}
			{pendingPaymentBox && pendingPaymentBox.box?.tenant && (
				<PaymentConfirmation
					tenant={pendingPaymentBox.box.tenant}
					roomNumber={typeof pendingPaymentBox.formatRoomDisplay === 'function' ? pendingPaymentBox.formatRoomDisplay(pendingPaymentBox.box) : pendingPaymentBox.box.number}
					propertyId={pendingPaymentBox.box.propertyId ?? property?.id}
					defaultAmount={pendingPaymentBox.box.payment}
					onClose={() => setPendingPaymentBox(null)}
					onSuccess={() => {
						authFetch(`/api/properties/${property?.id}/layouts/`).then(res => {
							if (res.ok) {
								res.json().then(data => {
									const propLayouts = JSON.parse(JSON.stringify(data.layouts || {}))
									const key = property?.propertyName
									if (key) setLayouts(prev => ({ ...prev, [key]: { ...(prev[key] || {}), ...propLayouts } }))
								})
							}
						}).catch(() => { })
						if (typeof parentPaymentSuccess === 'function') parentPaymentSuccess()
					}}
					batchRooms={(() => {
						const box = pendingPaymentBox.box
						const allBoxes = pendingPaymentBox.allBoxes || []
						if (!box?.tenant || !Array.isArray(allBoxes)) return undefined
						const tid = box.tenant.tenant_id ?? box.tenant.id
						const sameTenant = allBoxes.filter(b => b.tenant && (String(b.tenant.tenant_id) === String(tid) || String(b.tenant.id) === String(tid)))
						if (sameTenant.length <= 1) return undefined
						const propId = box.propertyId ?? property?.id
						return sameTenant.map(b => ({
							propertyId: b.propertyId ?? b.property_id ?? propId,
							roomNumber: typeof pendingPaymentBox.formatRoomDisplay === 'function' ? pendingPaymentBox.formatRoomDisplay(b) : (b.room_number ?? b.number),
							defaultAmount: b.payment
						}))
					})()}
				/>
			)}

			{pendingEditBox && pendingEditBox.box?.tenant && (() => {
				const box = pendingEditBox.box
				// Calculate base payment for EditTenant
				const applianceSurchargeTotal = (box.appliances || []).reduce((sum, a) => {
					return sum + (Number(a.surcharge_amount || a.surcharge || 0))
				}, 0)
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
							if (typeof parentPaymentSuccess === 'function') parentPaymentSuccess()
						}}
					/>
				)
			})()}

			{pendingTransferBox && pendingTransferBox.box?.tenant && (
				<TransferTenant
					tenant={pendingTransferBox.box.tenant}
					allBoxes={layouts[property?.propertyName]?.[variant] || []}
					propertyId={pendingTransferBox.box.propertyId}
					onClose={() => setPendingTransferBox(null)}
					onSuccess={() => {
						setPendingTransferBox(null)
						if (typeof parentPaymentSuccess === 'function') parentPaymentSuccess()
					}}
				/>
			)}

			{/* Fixed right-side RoomSidebar (can overlap legend) */}
			{!isEditing && boxes.find(b => b.id === selectedId && b.floor === floor) && (() => {
				const selectedBox = boxes.find(b => b.id === selectedId && b.floor === floor)
				return selectedBox ? (
					<div className="fixed right-4 top-20 z-50" key={`sidebar-${selectedBox.id}-${selectedBox.payment || 0}`}>
						<RoomSidebar
							box={{ ...selectedBox, propertyId: property?.id }}
							allBoxes={layouts[property?.propertyName]?.[variant] || []}
							onClose={() => setSelectedId(null)}
							onSave={saveBoxEdits}
							onAddTenant={(formattedRoom, roomType) => { if (typeof onOpenAddTenant === 'function') onOpenAddTenant(formattedRoom, boxes.filter(b => b.floor === floor).map(b => formatRoomDisplay(b)), floor, roomType) }}
							formatRoomDisplay={formatRoomDisplay}
							onViewTenantProfile={onViewTenantProfile}
							isArchived={!!property?.is_archived}
							onOpenPaymentModal={({ box, allBoxes, formatRoomDisplay: fmt }) => {
								setPendingPaymentBox({ box: { ...box, propertyId: property?.id }, allBoxes, formatRoomDisplay: fmt || formatRoomDisplay })
								setSelectedId(null)
							}}
							onOpenEditModal={({ box }) => {
								setPendingEditBox({ box: { ...box, propertyId: property?.id } })
								setSelectedId(null)
							}}
							onOpenTransferModal={({ box }) => {
								setPendingTransferBox({ box: { ...box, propertyId: property?.id } })
								setSelectedId(null)
							}}
							onPaymentSuccess={() => {
								// Cache-bust so we always get fresh layouts (e.g. after balance payment)
								authFetch(`/api/properties/${property.id}/layouts/?_=${Date.now()}`).then(res => {
									if (res.ok) {
										res.json().then(data => {
											const propLayouts = JSON.parse(JSON.stringify(data.layouts || {}))
											const key = property.propertyName
											setLayouts(prev => ({
												...prev,
												[key]: { ...(prev[key] || {}), ...propLayouts }
											}))
										})
									}
								}).catch(() => { })
								if (typeof parentPaymentSuccess === 'function') {
									parentPaymentSuccess()
								}
							}}
							onReceivableReceived={() => {
								authFetch(`/api/properties/${property.id}/layouts/?_=${Date.now()}`).then(res => {
									if (res.ok) {
										res.json().then(data => {
											const propLayouts = JSON.parse(JSON.stringify(data.layouts || {}))
											const key = property.propertyName
											setLayouts(prev => ({
												...prev,
												[key]: { ...(prev[key] || {}), ...propLayouts }
											}))
										})
									}
								}).catch(() => { })
							}}
						/>
					</div>
				) : null
			})()}
		</div>
	)
}

export default OccupancyMap


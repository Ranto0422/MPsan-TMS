import { useState, useEffect, useMemo } from 'react'
import { authFetch } from '../auth.js'
import AutomatedMessageSettings from './AutomatedMessageSettings.jsx'

function formatRoomDisplay(box) {
	if (!box) return ''
	const type = box.type || 'room'
	const number = box.number ?? ''
	const section = box.section ?? ''
	if (type === 'commercial') return `C${number}`
	if (section) return `${section.charAt(0).toUpperCase()}${number}`
	return `No.${number}`
}

function getInitials(name) {
	return name
		.split(' ')
		.map(n => n[0])
		.slice(0, 2)
		.join('')
		.toUpperCase()
}

function getRandomColor(name) {
	const colors = [
		'bg-red-500', 'bg-orange-500', 'bg-amber-500',
		'bg-green-500', 'bg-emerald-500', 'bg-teal-500',
		'bg-cyan-500', 'bg-sky-500', 'bg-blue-500',
		'bg-indigo-500', 'bg-violet-500', 'bg-purple-500',
		'bg-fuchsia-500', 'bg-pink-500', 'bg-rose-500'
	]
	let hash = 0
	for (let i = 0; i < name.length; i++) {
		hash = name.charCodeAt(i) + ((hash << 5) - hash)
	}
	return colors[Math.abs(hash) % colors.length]
}

export default function MassMessage({ property, layoutsRefreshKey }) {
	const [layouts, setLayouts] = useState({})
	const [loading, setLoading] = useState(true)
	const [selectedIds, setSelectedIds] = useState(new Set())
	const [messageText, setMessageText] = useState('')
	const [activeTab, setActiveTab] = useState('send') // 'send' or 'settings'
	const [sending, setSending] = useState(false)
	const [sendError, setSendError] = useState(null)
	const [sendSuccess, setSendSuccess] = useState(null)
	const [searchQuery, setSearchQuery] = useState('')
	const [channel, setChannel] = useState('sms')

	useEffect(() => {
		let cancelled = false
		if (!property?.id) {
			setLayouts({})
			setLoading(false)
			return
		}
		setLoading(true)
		authFetch(`/api/properties/${property.id}/layouts/`)
			.then(res => res.ok ? res.json() : { layouts: {} })
			.then(data => {
				if (cancelled) return
				const propLayouts = data.layouts || {}
				const key = property.propertyName || property.name || 'default'
				setLayouts({ [key]: typeof propLayouts === 'object' ? propLayouts : {} })
			})
			.catch(() => { if (!cancelled) setLayouts({}) })
			.finally(() => { if (!cancelled) setLoading(false) })
		return () => { cancelled = true }
	}, [property?.id, property?.propertyName, property?.name, layoutsRefreshKey])

	const key = property?.propertyName || property?.name || 'default'
	const variant = 'default'
	const allBoxes = Array.isArray(layouts[key]?.[variant]) ? layouts[key][variant] : []
	const tenantList = allBoxes
		.filter(b => b.tenant)
		.map(b => ({
			id: b.id,
			tenantId: b.tenant?.tenant_id ?? b.tenant?.id,
			name: b.tenant?.full_name || b.tenant?.name || 'N/A',
			phone: b.tenant?.phone || '',
			email: b.tenant?.email || '',
			roomDisplay: formatRoomDisplay(b),
			floor: b.floor || 1
		}))

	// Filter tenants by search
	const filteredTenants = useMemo(() => {
		if (!searchQuery.trim()) return tenantList
		const q = searchQuery.toLowerCase()
		return tenantList.filter(t =>
			t.name.toLowerCase().includes(q) ||
			t.roomDisplay.toLowerCase().includes(q) ||
			t.phone.includes(q)
		)
	}, [tenantList, searchQuery])

	// Group tenants by floor
	const tenantsByFloor = useMemo(() => {
		const grouped = {}
		filteredTenants.forEach(t => {
			if (!grouped[t.floor]) grouped[t.floor] = []
			grouped[t.floor].push(t)
		})
		return grouped
	}, [filteredTenants])

	const floorNumbers = Object.keys(tenantsByFloor).sort((a, b) => Number(a) - Number(b))

	const allSelected = filteredTenants.length > 0 && filteredTenants.every(t => selectedIds.has(t.id))
	// const someSelected = selectedIds.size > 0 // Unused

	const toggleSelectAll = () => {
		if (allSelected) setSelectedIds(new Set())
		else setSelectedIds(new Set(filteredTenants.map(t => t.id)))
	}

	const toggleFloor = (floorNum) => {
		const floorTenants = tenantsByFloor[floorNum] || []
		const allFloorSelected = floorTenants.every(t => selectedIds.has(t.id))
		setSelectedIds(prev => {
			const next = new Set(prev)
			floorTenants.forEach(t => {
				if (allFloorSelected) next.delete(t.id)
				else next.add(t.id)
			})
			return next
		})
	}

	const toggleTenant = (id) => {
		setSelectedIds(prev => {
			const next = new Set(prev)
			if (next.has(id)) next.delete(id)
			else next.add(id)
			return next
		})
	}

	const handleSendMessage = async () => {
		const count = selectedIds.size
		if (count === 0) {
			setSendError('Please select at least one tenant.')
			return
		}
		const tenantIdsToSend = tenantList
			.filter(t => selectedIds.has(t.id))
			.map(t => t.tenantId)
			.filter(id => id != null && id !== '')
		if (tenantIdsToSend.length === 0) {
			setSendError('Selected tenants have no valid IDs.')
			return
		}
		if (!messageText.trim()) {
			setSendError('Please enter a message.')
			return
		}
		setSendError(null)
		setSendSuccess(null)
		setSending(true)
		try {
			const res = await authFetch('/api/messages/send/', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					message: messageText.trim(),
					tenant_ids: tenantIdsToSend,
					channel: channel,
					property_id: property?.id || null,
				}),
			})
			const data = res.ok ? await res.json().catch(() => ({})) : await res.json().catch(() => ({}))
			if (!res.ok) {
				const detail = data?.detail || data?.message || `Send failed (${res.status})`
				const extra = data?.error ? ` ${data.error}` : ''
				setSendError(detail + extra)
				return
			}
			const parts = []
			if (data?.recipients > 0) parts.push(`${data.recipients} via SMS`)
			if (data?.email_recipients > 0) parts.push(`${data.email_recipients} via email`)
			const summary = parts.length > 0 ? parts.join(', ') : `${count} tenant(s)`
			setSendSuccess(`Message sent successfully to ${summary}!`)
			setMessageText('')
			setSelectedIds(new Set())
			setTimeout(() => setSendSuccess(null), 5000)
		} catch (e) {
			setSendError(e?.message || 'Failed to send message.')
		} finally {
			setSending(false)
		}
	}

	if (!property) {
		return (
			<div className="flex flex-col items-center justify-center h-full text-center p-8 bg-gray-50 dark:bg-gray-900">
				<div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-lg transform transition-all hover:scale-105">
					<div className="w-20 h-20 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-6">
						<svg className="w-10 h-10 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
						</svg>
					</div>
					<h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">No Property Selected</h3>
					<p className="text-gray-500 dark:text-gray-400">Please select a property to start messaging tenants.</p>
				</div>
			</div>
		)
	}

	if (loading) {
		return (
			<div className="flex items-center justify-center h-full bg-gray-50 dark:bg-gray-900">
				<div className="relative">
					<div className="w-16 h-16 border-4 border-blue-200 dark:border-blue-900 border-t-blue-600 dark:border-t-blue-400 rounded-full animate-spin"></div>
					<div className="mt-4 text-center text-sm font-medium text-gray-500 dark:text-gray-400">Loading...</div>
				</div>
			</div>
		)
	}

	return (
		<div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900 overflow-hidden font-sans">
			{/* Modern Header */}
			<div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 md:px-6 py-4 md:py-5 flex-shrink-0 z-10 shadow-sm">
				<div className="flex items-center justify-between mb-6">
					<div>
						<h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-400 dark:to-indigo-400">
							Message Center
						</h1>
						<p className="text-sm font-medium text-gray-500 dark:text-gray-400 mt-1 flex items-center gap-2">
							<span className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 py-0.5 px-2 rounded-full text-xs">
								{property.propertyName || property.name}
							</span>
							<span className="text-gray-300 dark:text-gray-600">•</span>
							<span>{tenantList.length} tenants total</span>
						</p>
					</div>
				</div>

				{/* Modern Tabs */}
				<div className="bg-gray-100/50 dark:bg-gray-700/50 p-1.5 rounded-xl flex relative shadow-inner max-w-full">
					<div
						className={`absolute top-1.5 bottom-1.5 rounded-lg bg-white dark:bg-gray-600 shadow-sm transition-all duration-300 ease-out ${activeTab === 'send' ? 'left-1.5 w-[calc(50%-6px)]' : 'left-[calc(50%+3px)] w-[calc(50%-6px)]'
							}`}
						aria-hidden="true"
					/>
					<button
						type="button"
						onClick={() => setActiveTab('send')}
						className={`relative z-10 flex-1 px-8 py-2.5 rounded-lg text-sm font-semibold transition-colors duration-200 flex items-center gap-2.5 ${activeTab === 'send'
							? 'text-blue-600 dark:text-white'
							: 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
							}`}
					>
						<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
						</svg>
						Send
					</button>
					<button
						type="button"
						onClick={() => setActiveTab('settings')}
						className={`relative z-10 flex-1 px-8 py-2.5 rounded-lg text-sm font-semibold transition-colors duration-200 flex items-center gap-2.5 ${activeTab === 'settings'
							? 'text-blue-600 dark:text-white'
							: 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
							}`}
					>
						<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
						</svg>
						Automated
					</button>
				</div>
			</div>

			{/* Content Area */}
			{activeTab === 'settings' ? (
				<div className="flex-1 overflow-auto bg-gray-50/50 dark:bg-gray-900 p-6 animate-fade-in">
					<AutomatedMessageSettings property={property} onBack={() => setActiveTab('send')} embedded />
				</div>
			) : (
				<div className="flex-1 flex flex-col lg:flex-row gap-6 p-4 md:p-6 min-h-0 overflow-y-auto lg:overflow-hidden animate-fade-in-up">
					{/* Left: Tenant Selection */}
					<div className="w-full lg:w-96 flex flex-col bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden transition-all hover:shadow-md flex-shrink-0 h-[400px] lg:h-auto">
						{/* Selection Header */}
						<div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 z-10">
							<div className="flex items-center justify-between mb-4">
								<h2 className="font-bold text-gray-900 dark:text-white text-lg">Recipients</h2>
								<span className={`text-xs font-bold px-3 py-1.5 rounded-full transition-colors ${selectedIds.size > 0
									? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
									: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
									}`}>
									{selectedIds.size} selected
								</span>
							</div>

							{/* Modern Search */}
							<div className="relative group">
								<div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
									<svg className="w-5 h-5 text-gray-400 group-focus-within:text-blue-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
									</svg>
								</div>
								<input
									type="text"
									placeholder="Search by name, room, or phone..."
									value={searchQuery}
									onChange={e => setSearchQuery(e.target.value)}
									className="block w-full pl-10 pr-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-700 text-sm placeholder-gray-400 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 dark:text-white transition-all shadow-sm"
								/>
							</div>
						</div>

						{/* Select All Bar */}
						<div className="px-5 py-2.5 bg-gray-50/80 dark:bg-gray-700/30 border-b border-gray-100 dark:border-gray-700 flex items-center">
							<label className="flex items-center gap-3 cursor-pointer group w-full">
								<div className={`w-5 h-5 rounded-md border flex items-center justify-center transition-all duration-200 ${allSelected
									? 'bg-blue-600 border-blue-600'
									: 'border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-700 group-hover:border-blue-400'
									}`}>
									{allSelected && <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
									<input type="checkbox" className="sr-only" checked={allSelected} onChange={toggleSelectAll} />
								</div>
								<span className="text-sm font-semibold text-gray-700 dark:text-gray-300 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
									Select All ({filteredTenants.length})
								</span>
							</label>
						</div>

						{/* Tenant List */}
						<div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-200 dark:scrollbar-thumb-gray-600">
							{filteredTenants.length === 0 ? (
								<div className="flex flex-col items-center justify-center h-40 text-center p-6">
									<div className="w-12 h-12 bg-gray-100 dark:bg-gray-700/50 rounded-full flex items-center justify-center mb-3">
										<svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
										</svg>
									</div>
									<p className="text-sm font-medium text-gray-500 dark:text-gray-400">
										{searchQuery ? 'No matching tenants' : 'No tenants found'}
									</p>
								</div>
							) : (
								floorNumbers.map(floorNum => {
									const floorTenants = tenantsByFloor[floorNum] || []
									const allFloorSelected = floorTenants.every(t => selectedIds.has(t.id))
									const someFloorSelected = floorTenants.some(t => selectedIds.has(t.id))

									return (
										<div key={floorNum} className="border-b border-gray-100 dark:border-gray-700/50 last:border-b-0">
											{/* Floor Header */}
											<div
												className="px-5 py-2 bg-gray-50/50 dark:bg-gray-700/20 backdrop-blur-sm sticky top-0 z-10 flex items-center justify-between cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/40 transition-colors"
												onClick={() => toggleFloor(floorNum)}
											>
												<div className="flex items-center gap-2.5">
													<div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${allFloorSelected
														? 'bg-blue-600 border-blue-600'
														: (someFloorSelected && !allFloorSelected)
															? 'bg-blue-600 border-blue-600'
															: 'border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-700'
														}`}>
														{allFloorSelected && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
														{!allFloorSelected && someFloorSelected && <div className="w-2 h-0.5 bg-white rounded-full"></div>}
													</div>
													<span className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
														Floor {floorNum}
													</span>
												</div>
												<span className="text-xs font-medium text-gray-400 dark:text-gray-500">
													{floorTenants.filter(t => selectedIds.has(t.id)).length} / {floorTenants.length}
												</span>
											</div>

											{/* Floor Tenants List */}
											<div className="divide-y divide-gray-50 dark:divide-gray-700/30">
												{floorTenants.map(t => {
													const isSelected = selectedIds.has(t.id)
													return (
														<label
															key={t.id}
															className={`flex items-center gap-4 px-5 py-3 cursor-pointer transition-all duration-200 group ${isSelected
																? 'bg-blue-50/80 dark:bg-blue-900/20'
																: 'hover:bg-gray-50 dark:hover:bg-gray-700/30'
																}`}
														>
															<div className={`w-5 h-5 rounded-md border flex-shrink-0 flex items-center justify-center transition-all ${isSelected
																? 'bg-blue-600 border-blue-600'
																: 'border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-700 group-hover:border-blue-400'
																}`}>
																{isSelected && <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
																<input type="checkbox" className="sr-only" checked={isSelected} onChange={() => toggleTenant(t.id)} />
															</div>

															{/* Avatar */}
															<div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-sm flex-shrink-0 ${getRandomColor(t.name)}`}>
																{getInitials(t.name)}
															</div>

															<div className="flex-1 min-w-0">
																<div className={`text-sm font-semibold truncate transition-colors ${isSelected ? 'text-blue-700 dark:text-blue-300' : 'text-gray-900 dark:text-white'
																	}`}>
																	{t.name}
																</div>
																<div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2 mt-0.5">
																	<span className="font-medium bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded text-gray-600 dark:text-gray-300">
																		{t.roomDisplay}
																	</span>
																	{t.phone && <span className="truncate opacity-75">{t.phone}</span>}
																{t.email && <span className="text-green-500 dark:text-green-400 text-[10px] font-bold" title={t.email}>@</span>}
																</div>
															</div>
														</label>
													)
												})}
											</div>
										</div>
									)
								})
							)}
						</div>
					</div>

					{/* Right: Compose Message */}
					<div className="w-full lg:w-auto flex-none lg:flex-1 flex flex-col bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden transition-all hover:shadow-md min-h-[500px] lg:min-h-0">
						<div className="p-6 pb-4 border-b border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800">
							<h2 className="text-xl font-bold text-gray-900 dark:text-white">Compose Message</h2>
							<p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
								{channel === 'sms' ? 'Send SMS to selected tenants instantly.' :
								 channel === 'email' ? 'Send email to selected tenants instantly.' :
								 'Send both SMS and email to selected tenants.'}
							</p>
							{/* Channel selector */}
							<div className="flex gap-2 mt-3">
								{['sms', 'email', 'both'].map(ch => (
									<button
										key={ch}
										type="button"
										onClick={() => setChannel(ch)}
										className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
											channel === ch
												? 'bg-blue-600 text-white border-blue-600'
												: 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
										}`}
									>
										{ch === 'sms' ? 'SMS' : ch === 'email' ? 'Email' : 'Both'}
									</button>
								))}
							</div>
							{channel !== 'sms' && (() => {
								const noEmail = tenantList.filter(t => selectedIds.has(t.id) && !t.email).length
								return noEmail > 0 ? (
									<p className="text-xs text-amber-600 dark:text-amber-400 mt-2">{noEmail} selected tenant(s) have no email and will only receive SMS.</p>
								) : null
							})()}
						</div>

						{/* Message Editor */}
						<div className="flex-1 p-6 flex flex-col min-h-0 bg-gray-50/30 dark:bg-gray-900/20">
							{/* Status Alerts */}
							{sendError && (
								<div className="mb-5 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800/50 flex items-start gap-3 animate-slide-up">
									<div className="bg-red-100 dark:bg-red-800 rounded-full p-1 flex-shrink-0">
										<svg className="w-4 h-4 text-red-600 dark:text-red-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
											<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
										</svg>
									</div>
									<div className="flex-1">
										<h4 className="text-sm font-bold text-red-900 dark:text-red-100">Delivery Failed</h4>
										<p className="text-sm text-red-700 dark:text-red-300 mt-0.5">{sendError}</p>
									</div>
									<button onClick={() => setSendError(null)} className="text-red-500 hover:text-red-700">
										<span className="sr-only">Dismiss</span>
										<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
									</button>
								</div>
							)}

							{sendSuccess && (
								<div className="mb-5 p-4 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-800/50 flex items-start gap-3 animate-slide-up">
									<div className="bg-green-100 dark:bg-green-800 rounded-full p-1 flex-shrink-0">
										<svg className="w-4 h-4 text-green-600 dark:text-green-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
											<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
										</svg>
									</div>
									<div className="flex-1">
										<h4 className="text-sm font-bold text-green-900 dark:text-green-100">Message Sent!</h4>
										<p className="text-sm text-green-700 dark:text-green-300 mt-0.5">{sendSuccess}</p>
									</div>
								</div>
							)}

							{/* Text Area */}
							<div className="flex-1 relative group">
								<textarea
									value={messageText}
									onChange={e => setMessageText(e.target.value)}
									placeholder="Type your message here..."
									className="w-full h-full p-5 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white resize-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-sans text-base leading-relaxed shadow-sm group-hover:shadow-md"
									disabled={sending}
								/>
								<div className="absolute bottom-4 right-4 text-xs font-medium text-gray-400 bg-white/80 dark:bg-gray-800/80 backdrop-blur px-2 py-1 rounded border border-gray-100 dark:border-gray-700">
									{messageText.length} chars • {Math.ceil(messageText.length / 160) || 1} SMS
								</div>
							</div>

							{/* Chips / Templates */}
							<div className="mt-4">
								<p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Quick Templates</p>
								<div className="flex flex-wrap gap-2">
									{[
										{ label: 'Payment Reminder', text: 'Good day! This is a friendly reminder that your rent payment is due. Please settle at your earliest convenience. Thank you!' },
										{ label: 'Maintenance', text: 'Good day! Please be informed that there will be a scheduled maintenance on [DATE]. We apologize for any inconvenience. Thank you!' },
										{ label: 'Rent Adjustment', text: 'Good day! We would like to inform you of an upcoming rent adjustment effective [DATE]. For questions, please contact us. Thank you!' }
									].map((template, idx) => (
										<button
											key={idx}
											type="button"
											onClick={() => setMessageText(template.text)}
											className="px-3 py-1.5 text-xs font-semibold bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-full hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-300 dark:hover:border-blue-700 hover:text-blue-700 dark:hover:text-blue-300 transition-all transform hover:-translate-y-0.5"
										>
											{template.label}
										</button>
									))}
								</div>
							</div>
						</div>

						{/* Footer Actions */}
						<div className="p-6 border-t border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800">
							<div className="flex flex-col sm:flex-row items-center justify-between gap-4">
								<div className="text-sm text-gray-500 dark:text-gray-400">
									{selectedIds.size > 0 ? (
										<span className="flex items-center gap-2">
											<span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
											Ready to send to <strong className="text-gray-900 dark:text-white">{selectedIds.size}</strong> recipients
										</span>
									) : (
										<span className="text-gray-400 dark:text-gray-600">No recipients selected</span>
									)}
								</div>

								<button
									type="button"
									onClick={handleSendMessage}
									disabled={sending || selectedIds.size === 0 || !messageText.trim()}
									className={`w-full sm:w-auto px-8 py-3 rounded-xl font-bold text-white shadow-lg shadow-blue-500/30 transition-all transform hover:-translate-y-0.5 active:translate-y-0 active:shadow-md disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none flex items-center justify-center gap-2 ${sending ? 'bg-blue-700' : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700'
										}`}
								>
									{sending ? (
										<>
											<svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
												<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
												<path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
											</svg>
											Sending...
										</>
									) : (
										<>
											<span>Send Message</span>
											<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
											</svg>
										</>
									)}
								</button>
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	)
}

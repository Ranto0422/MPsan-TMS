import { useState, useEffect, useRef } from 'react'
import { FaBuilding, FaCity, FaCheck, FaLayerGroup, FaChevronLeft, FaSearch, FaChevronRight, FaChevronDown, FaArchive } from 'react-icons/fa'
import { HiOfficeBuilding } from 'react-icons/hi'

/**
 * Props:
 *  onSelect?: (propertyName: string) => void
 *  initialSelected?: string
 *  responsive?: boolean   // enables mobile FAB + overlay
 */
function PropertyList({ onSelect, initialSelected = null, responsive = true, properties = [], currentUser = null }) {
  const [selected, setSelected] = useState(initialSelected)
  const [isMobile, setIsMobile] = useState(false)
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [isHovered, setIsHovered] = useState(false)
  const [showArchived, setShowArchived] = useState(null) // owner name string or null

  // Collapse state for desktop
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try {
      return localStorage.getItem('propertyListCollapsed') === 'true'
    } catch (e) {
      return false
    }
  })

  // Resizable state for desktop
  const [width, setWidth] = useState(() => {
    try {
      const saved = parseInt(localStorage.getItem('propertyListWidth'))
      if (!isNaN(saved)) return Math.min(400, Math.max(64, saved))
    } catch (e) { }
    return 288 // default px (approx w-72)
  })

  const draggingRef = useRef(false)
  const containerRef = useRef(null)
  const MIN_WIDTH = 64
  const MAX_WIDTH = 400

  const [isVisible, setIsVisible] = useState(true)
  const lastScrollY = useRef(0)
  const hoverTimeoutRef = useRef(null)

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768
      setIsMobile(mobile)
      if (!mobile) setOverlayOpen(false)
    }

    const handleScroll = () => {
      if (window.innerWidth >= 768) {
        setIsVisible(true)
        return
      }
      const currentScrollY = window.scrollY
      if (currentScrollY > lastScrollY.current && currentScrollY > 100) {
        setIsVisible(false)
      } else {
        setIsVisible(true)
      }
      lastScrollY.current = currentScrollY
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('scroll', handleScroll)
    }
  }, [])

  // Persist desktop preferences
  useEffect(() => {
    try {
      localStorage.setItem('propertyListWidth', String(width))
      localStorage.setItem('propertyListCollapsed', String(isCollapsed))
    } catch (e) { }
  }, [width, isCollapsed])

  const handleSelect = (property) => {
    setSelected(property)
    onSelect?.(property)
    if (isMobile && overlayOpen) setOverlayOpen(false)
  }

  const startDrag = (e) => {
    if (isMobile) return
    draggingRef.current = true
    document.addEventListener('mousemove', handleDrag)
    document.addEventListener('mouseup', stopDrag)
    e.preventDefault()
  }

  const handleDrag = (e) => {
    if (!draggingRef.current) return
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    let newWidth = e.clientX - rect.left
    if (newWidth < MIN_WIDTH) newWidth = MIN_WIDTH
    if (newWidth > MAX_WIDTH) newWidth = MAX_WIDTH
    setWidth(newWidth)
  }

  const stopDrag = () => {
    draggingRef.current = false
    document.removeEventListener('mousemove', handleDrag)
    document.removeEventListener('mouseup', stopDrag)
  }

  // Group properties (active + archived per owner)
  const buildGroups = () => {
    if (!properties || properties.length === 0) return {}

    const ownerMap = new Map()

    const mapProp = (p) => ({
      propertyName: p.name || p.propertyName,
      address: p.address,
      id: p.id,
      floors: p.floors || 1,
      city: p.city,
      is_archived: p.is_archived || false
    })

    const getOwnerKey = (p) => {
      const owners = p.owners_detail && p.owners_detail.length ? p.owners_detail : (p.owners || [])
      const owner = Array.isArray(owners) && owners.length ? owners[0] : null
      const ownerName = owner && (owner.full_name || owner.username || owner.name)
      return ownerName ? `${ownerName}` : 'Unassigned'
    }

    // Add active properties (filtered by search)
    properties.filter(p =>
      !p.is_archived && (
        !searchTerm ||
        p.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.propertyName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.address?.toLowerCase().includes(searchTerm.toLowerCase())
      )
    ).forEach(p => {
      const key = getOwnerKey(p)
      if (!ownerMap.has(key)) ownerMap.set(key, { active: [], archived: [] })
      ownerMap.get(key).active.push(mapProp(p))
    })

    // Add archived properties under their owner
    properties.filter(p => p.is_archived).forEach(p => {
      const key = getOwnerKey(p)
      if (!ownerMap.has(key)) ownerMap.set(key, { active: [], archived: [] })
      ownerMap.get(key).archived.push(mapProp(p))
    })

    const groups = {}
    for (const [k, v] of ownerMap.entries()) groups[k] = v
    return groups
  }

  const groups = buildGroups()
  const hasProperties = Object.keys(groups).some(k => groups[k].active.length > 0)

  // -------------------------
  // DESKTOP VIEW COMPONENT
  // -------------------------
  const DesktopList = (
    <div
      ref={containerRef}
      style={{ width: (isCollapsed && !isHovered) ? '72px' : `${width}px` }}
      className="h-full flex-shrink-0 flex flex-col bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 relative transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] group"
    >
      {/* Resizer Handle */}
      {
        !isCollapsed && (
          <div
            onMouseDown={startDrag}
            className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-blue-500 z-50 transition-colors opacity-0 group-hover:opacity-100"
          />
        )
      }

      {/* Header */}
      <div
        className={`flex-shrink-0 h-16 flex items-center ${isCollapsed ? 'justify-center cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700' : 'justify-between px-4'} bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 transition-colors`}
        onClick={() => isCollapsed && setIsCollapsed(false)}
      >
        {!isCollapsed ? (
          <div className="flex items-center gap-2 overflow-hidden">
            <div className="p-1.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg">
              <HiOfficeBuilding className="w-5 h-5" />
            </div>
            <span className="font-bold text-gray-800 dark:text-white truncate">Properties</span>
          </div>
        ) : (
          <div className="p-2 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg" title="Click to expand">
            <FaChevronRight className="w-5 h-5" />
          </div>
        )}

        {/* Toggle Button */}
        {!isCollapsed && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              setIsCollapsed(true)
            }}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors"
          >
            <FaChevronLeft className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Search Bar (only when expanded) */}
      {
        !isCollapsed && (
          <div className="p-3 bg-gray-50 dark:bg-gray-900">
            <div className="relative">
              <input
                type="text"
                placeholder="Search..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-white placeholder-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-shadow"
              />
              <FaSearch className="absolute left-3 top-2.5 text-gray-400 w-3.5 h-3.5" />
            </div>
          </div>
        )
      }

      {/* List Content */}
      <div
        onMouseEnter={() => {
          hoverTimeoutRef.current = setTimeout(() => {
            setIsHovered(true)
          }, 300)
        }}
        onMouseLeave={() => {
          if (hoverTimeoutRef.current) {
            clearTimeout(hoverTimeoutRef.current)
            hoverTimeoutRef.current = null
          }
          setIsHovered(false)
        }}
        className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600"
      >
        {!hasProperties && (
          <div className="p-4 text-center text-gray-500 text-sm">
            {searchTerm ? 'No matches found' : 'No properties available'}
          </div>
        )}

        {Object.entries(groups).map(([ownerName, group], index) => (
          <div key={ownerName} className="mb-2">
            {/* Separator for subsequent groups */}
            {index > 0 && (
              <div className={`my-2 border-t border-gray-200 dark:border-gray-700 ${(isCollapsed && !isHovered) ? 'mx-2' : 'mx-4'}`}></div>
            )}

            {(!isCollapsed || isHovered) && (
              <div className="px-4 py-2 bg-gray-100/50 dark:bg-gray-800/50 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider sticky top-0 backdrop-blur-sm z-10">
                {ownerName}
              </div>
            )}

            <div className="p-2 space-y-1">
              {group.active.map(p => {
                const isActive = selected && ((selected.propertyName ?? selected.name) === p.propertyName || selected.id === p.id)

                if (isCollapsed && !isHovered) {
                  return (
                    <button
                      key={p.id || p.propertyName}
                      onClick={() => handleSelect(p)}
                      title={`${p.propertyName}\n${p.address}`}
                      className={`w-full aspect-square rounded-xl flex items-center justify-center text-sm font-bold transition-all duration-200 ${isActive
                        ? 'bg-blue-600 text-white shadow-lg scale-105'
                        : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-white hover:shadow-md'
                        }`}
                    >
                      {p.propertyName.charAt(0).toUpperCase()}
                    </button>
                  )
                }

                return (
                  <button
                    key={p.id || p.propertyName}
                    onClick={() => handleSelect(p)}
                    className={`w-full text-left p-3 rounded-xl border transition-all duration-200 group/item relative overflow-hidden ${isActive
                      ? 'bg-white dark:bg-gray-800 border-blue-500 ring-1 ring-blue-500 shadow-md transform scale-[1.02] z-10'
                      : 'bg-white dark:bg-gray-800 border-transparent hover:border-gray-200 dark:hover:border-gray-700 hover:shadow-lg hover:-translate-y-0.5'
                      }`}
                  >
                    {isActive && <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500" />}

                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-lg flex-shrink-0 ${isActive
                        ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 group-hover/item:bg-blue-50 dark:group-hover/item:bg-blue-900/20 group-hover/item:text-blue-500'
                        }`}>
                        <FaBuilding className="w-4 h-4" />
                      </div>

                      <div className="min-w-0 flex-1">
                        <h4 className={`font-semibold text-sm truncate ${isActive ? 'text-blue-700 dark:text-blue-400' : 'text-gray-800 dark:text-gray-200'
                          }`}>
                          {p.propertyName}
                        </h4>
                        <div className="flex items-center gap-1.5 mt-1 text-xs text-gray-500 dark:text-gray-400">
                          <FaCity className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">{p.address}</span>
                        </div>
                        {/* Optional Badge */}
                        {p.floors > 1 && (
                          <span className="inline-flex items-center gap-1 mt-2 px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                            <FaLayerGroup className="w-2.5 h-2.5" />
                            {p.floors} Floors
                          </span>
                        )}
                      </div>

                      {isActive && <FaCheck className="w-3.5 h-3.5 text-blue-500 mt-1" />}
                    </div>
                  </button>
                )
              })}

              {/* Archived buildings under this owner */}
              {group.archived.length > 0 && (!isCollapsed || isHovered) && (
                <button
                  onClick={() => setShowArchived(prev => prev === ownerName ? null : ownerName)}
                  className="w-full flex items-center justify-between px-3 py-1.5 text-[10px] font-medium text-gray-400 hover:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors mt-1"
                >
                  <span className="flex items-center gap-1">
                    <FaArchive className="w-2.5 h-2.5" />
                    Archived ({group.archived.length})
                  </span>
                  <FaChevronDown className={`w-2.5 h-2.5 transition-transform ${showArchived === ownerName ? 'rotate-180' : ''}`} />
                </button>
              )}
              {showArchived === ownerName && group.archived.map(p => {
                const isActive = selected && (selected.id === p.id)
                return (
                  <button
                    key={p.id}
                    onClick={() => handleSelect(p)}
                    className={`w-full text-left p-2.5 rounded-lg border border-dashed transition-all duration-200 ${isActive
                      ? 'border-amber-400 bg-amber-50 dark:bg-amber-900/20 ring-1 ring-amber-400 opacity-80'
                      : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 opacity-60 hover:opacity-80 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <FaArchive className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${isActive ? 'text-amber-500' : 'text-gray-400'}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <h4 className={`font-medium text-xs truncate ${isActive ? 'text-amber-700 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400'}`}>{p.propertyName}</h4>
                          <span className="text-[8px] px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 font-medium flex-shrink-0">ARCHIVED</span>
                        </div>
                        <p className="text-[10px] text-gray-400 truncate">{p.address}</p>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div >
  )

  // -------------------------
  // MOBILE VIEW - CARD OVERLAY
  // -------------------------
  const [isClosing, setIsClosing] = useState(false)

  const closeOverlay = () => {
    setIsClosing(true)
    setTimeout(() => {
      setOverlayOpen(false)
      setIsClosing(false)
    }, 400)
  }

  const handleSelectWithAnim = (property) => {
    setSelected(property)
    onSelect?.(property)
    if (isMobile && overlayOpen) closeOverlay()
  }

  if (isMobile) {
    if (!responsive) return null

    return (
      <>
        {/* FAB Button - Moved up to clear 80px bottom nav */}
        {!overlayOpen && (
          <button
            onClick={() => setOverlayOpen(true)}
            className={`fixed bottom-24 right-6 z-50 p-4 bg-blue-600 text-white rounded-full shadow-2xl hover:bg-blue-700 active:scale-90 transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] flex items-center justify-center group/fab ${isVisible ? 'translate-y-0 opacity-100' : 'translate-y-32 opacity-0 pointer-events-none'}`}
            aria-label="Select Property"
          >
            <HiOfficeBuilding className="w-6 h-6 relative z-10" />
          </button>
        )}

        {/* Full Screen Modal with Bottom Sheet vibe */}
        {(overlayOpen || isClosing) && (
          <div className={`fixed inset-0 z-[60] flex flex-col items-end sm:items-center justify-end sm:justify-center bg-black/60 backdrop-blur-sm ${isClosing ? 'animate-fade-out' : 'animate-fade-in'}`}>
            {/* Backdrop click to close */}
            <div className="absolute inset-0" onClick={closeOverlay} />

            {/* Modal Content */}
            <div className={`relative w-full sm:w-[500px] max-h-[85vh] bg-gray-50 dark:bg-gray-900 rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col ${isClosing ? 'animate-slide-out-bottom' : 'animate-slide-in-bottom'}`}>

              {/* Header */}
              <div className="px-6 py-5 bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between sticky top-0 z-10">
                <div>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">Select Property</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Choose a location to manage</p>
                </div>
                <button
                  onClick={closeOverlay}
                  className="p-2 bg-gray-100 dark:bg-gray-700 rounded-full text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>

              {/* Search */}
              <div className="p-4 bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
                <div className="relative">
                  <FaSearch className="absolute left-4 top-3.5 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search buildings or addresses..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-gray-100 dark:bg-gray-700/50 rounded-xl text-gray-900 dark:text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all"
                  />
                </div>
              </div>

              {/* Scrollable List */}
              <div className="flex-1 overflow-y-auto p-4 space-y-6">
                {!hasProperties && (
                  <div className="py-12 flex flex-col items-center justify-center text-gray-500 dark:text-gray-400">
                    <HiOfficeBuilding className="w-12 h-12 mb-3 opacity-20" />
                    <p>No properties found</p>
                  </div>
                )}

                {Object.entries(groups).map(([ownerName, group]) => (
                  <div key={ownerName}>
                    <div className="flex items-center gap-2 mb-3 px-2">
                      <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700"></span>
                      <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">{ownerName}</span>
                      <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700"></span>
                    </div>

                    <div className="grid gap-3">
                      {group.active.map(p => {
                        const isActive = selected && ((selected.propertyName ?? selected.name) === p.propertyName || selected.id === p.id)
                        return (
                          <button
                            key={p.id}
                            onClick={() => handleSelectWithAnim(p)}
                            className={`w-full text-left bg-white dark:bg-gray-800 p-4 rounded-2xl shadow-sm border transition-all duration-200 active:scale-[0.98] ${isActive
                              ? 'border-blue-500 ring-2 ring-blue-500/20 shadow-blue-500/10'
                              : 'border-transparent hover:border-gray-200 dark:hover:border-gray-700'
                              }`}
                          >
                            <div className="flex justify-between items-start">
                              <div className="flex gap-4">
                                <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 shadow-inner ${isActive
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                                  }`}>
                                  <FaBuilding className="w-5 h-5" />
                                </div>
                                <div>
                                  <h3 className={`font-bold text-base leading-tight ${isActive ? 'text-blue-700 dark:text-blue-400' : 'text-gray-900 dark:text-white'
                                    }`}>
                                    {p.propertyName}
                                  </h3>
                                  <p className="flex items-center gap-1.5 mt-1 text-sm text-gray-500 dark:text-gray-400">
                                    <FaCity className="w-3.5 h-3.5 flex-shrink-0 opacity-70" />
                                    <span>{p.address}</span>
                                  </p>
                                  {p.city && (
                                    <span className="inline-block mt-2 text-xs font-medium text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded">
                                      {p.city}
                                    </span>
                                  )}
                                </div>
                              </div>
                              {isActive && (
                                <div className="bg-blue-100 dark:bg-blue-900/50 text-blue-600 p-1 rounded-full">
                                  <FaCheck className="w-3 h-3" />
                                </div>
                              )}
                            </div>
                          </button>
                        )
                      })}

                      {/* Archived buildings under this owner */}
                      {group.archived.length > 0 && (
                        <>
                          <button
                            onClick={() => setShowArchived(prev => prev === ownerName ? null : ownerName)}
                            className="w-full flex items-center justify-between px-4 py-2 text-xs font-medium text-gray-400 hover:text-gray-500 bg-gray-100 dark:bg-gray-800 rounded-xl transition-colors"
                          >
                            <span className="flex items-center gap-1.5">
                              <FaArchive className="w-3 h-3" />
                              Archived ({group.archived.length})
                            </span>
                            <FaChevronDown className={`w-3 h-3 transition-transform ${showArchived === ownerName ? 'rotate-180' : ''}`} />
                          </button>
                          {showArchived === ownerName && group.archived.map(p => {
                            const isActive = selected && (selected.id === p.id)
                            return (
                              <button
                                key={p.id}
                                onClick={() => handleSelectWithAnim(p)}
                                className={`w-full text-left p-3 rounded-xl border border-dashed transition-all duration-200 active:scale-[0.98] ${isActive
                                  ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-400 ring-2 ring-amber-400/20 opacity-80'
                                  : 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700 opacity-60 hover:opacity-80'
                                }`}
                              >
                                <div className="flex gap-3 items-center">
                                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isActive
                                    ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
                                    : 'bg-gray-200 dark:bg-gray-700 text-gray-400'
                                  }`}>
                                    <FaArchive className="w-4 h-4" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <h3 className={`font-medium text-sm truncate ${isActive ? 'text-amber-700 dark:text-amber-400' : 'text-gray-500'}`}>{p.propertyName}</h3>
                                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 font-medium flex-shrink-0">ARCHIVED</span>
                                    </div>
                                    <p className="text-xs text-gray-400">{p.address}</p>
                                  </div>
                                </div>
                              </button>
                            )
                          })}
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </>
    )
  }

  // DESKTOP RENDER
  return DesktopList
}

export default PropertyList
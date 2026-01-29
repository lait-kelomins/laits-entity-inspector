/**
 * Entity Inspector - WebSocket Client
 * ASCII/Terminal aesthetic debugging tool for Hytale
 */

/**
 * Escape HTML to prevent XSS attacks from malicious entity/component data.
 * Malicious plugins could set entity names to "<script>..." or similar.
 */
function escapeHtml(unsafe) {
    if (unsafe === null || unsafe === undefined) return '';
    return String(unsafe)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

class EntityInspector {
    constructor() {
        // State
        this.entities = new Map();
        this.selectedEntityId = null;
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 2000;
        this.startTime = Date.now();
        this.lastUpdate = null;
        this.worldName = '---';
        this.filter = '';
        this.componentFilter = '';

        // Tab state
        this.activeTab = 'entities';

        // Asset browser state
        this.hytalorEnabled = false;
        this.assetCategories = [];
        this.selectedCategory = null;
        this.assets = [];
        this.selectedAsset = null;
        this.assetDetail = null;
        this.assetFilter = '';
        this.searchMode = 'category'; // 'category' or 'global'
        this.sessionHistory = [];

        // Global changed components tracking (across all entities)
        this.globalChanges = []; // [{entityId, entityName, componentName, timestamp}]
        this.chipRetentionMs = 8000;
        this.maxGlobalChips = 12;

        // Components to ignore in global change tracking (too noisy)
        this.ignoredComponents = new Set([
            'TransformComponent',
            'SnapshotBuffer',
            'InteractionManager',
            'MovementComponent',
            'PhysicsComponent',
            'VelocityComponent',
            'PositionComponent',
            'Velocity',
            'PositionDataComponent',
            'ChunkTracker',
            'MovementAudioComponent',
            'ItemComponent',
            'ItemPhysicsComponent',
            'ActiveAnimationComponent'
        ]);

        // Packet log state
        this.packetLog = [];               // All logged packets
        this.packetLogPaused = false;
        this.packetLogFilter = '';
        this.packetDirectionFilter = 'all';
        this.selectedPacket = null;
        this.maxPacketLogSize = 1000;
        this.packetLogCollapsed = false;
        this.packetLogFullscreen = false;

        // Settings state
        this.settingsOpen = false;
        this.serverConfig = null;          // Config received from server
        this.pauseOnExpand = localStorage.getItem('inspector-pause-on-expand') !== 'false'; // Default true

        // DOM elements
        this.statusEl = document.getElementById('connection-status');
        this.entityCountEl = document.getElementById('entity-count');
        this.worldNameEl = document.getElementById('world-name');
        this.uptimeEl = document.getElementById('uptime');
        this.lastUpdateEl = document.getElementById('last-update');
        this.entityListEl = document.getElementById('entity-list');
        this.inspectorEl = document.getElementById('inspector-content');
        this.searchInput = document.getElementById('search-input');
        this.componentFilterInput = document.getElementById('component-filter');
        this.logContent = document.getElementById('log-content');
        this.eventLog = document.getElementById('event-log');

        // Global changes header elements
        this.changedHeaderEl = document.getElementById('changed-components-header');
        this.componentChipsEl = document.getElementById('component-chips');

        // Packet log elements
        this.packetLogPanel = document.getElementById('packet-log-panel');
        this.packetLogHeader = document.getElementById('packet-log-header');
        this.packetLogBody = document.getElementById('packet-log-body');
        this.packetLogToggle = document.getElementById('packet-log-toggle');
        this.packetList = document.getElementById('packet-list');
        this.packetDetail = document.getElementById('packet-detail');
        this.packetPauseBtn = document.getElementById('packet-pause-btn');
        this.packetPauseIcon = document.getElementById('packet-pause-icon');
        this.packetClearBtn = document.getElementById('packet-clear-btn');
        this.packetFullscreenBtn = document.getElementById('packet-fullscreen-btn');
        this.entityListPanel = document.getElementById('entity-list-panel');
        this.inspectorPanel = document.getElementById('inspector-panel');
        this.resizeHandle = document.getElementById('resize-handle');
        this.mainEl = document.querySelector('.main');
        this.packetFilterInput = document.getElementById('packet-filter-input');
        this.packetDirectionSelect = document.getElementById('packet-direction-filter');
        this.packetCountEl = document.getElementById('packet-count');

        // Settings elements
        this.settingsModal = document.getElementById('settings-modal');
        this.settingsToggleBtn = document.getElementById('settings-toggle-btn');
        this.settingsCloseBtn = document.getElementById('settings-close');
        this.settingsApplyBtn = document.getElementById('settings-apply');
        this.settingsCancelBtn = document.getElementById('settings-cancel');
        this.settingsStatusEl = document.getElementById('settings-status');

        // Settings inputs
        this.settingEnabled = document.getElementById('setting-enabled');
        this.settingUpdateInterval = document.getElementById('setting-update-interval');
        this.settingMaxCached = document.getElementById('setting-max-cached');
        this.settingIncludeNPCs = document.getElementById('setting-include-npcs');
        this.settingIncludePlayers = document.getElementById('setting-include-players');
        this.settingIncludeItems = document.getElementById('setting-include-items');
        this.settingPacketEnabled = document.getElementById('setting-packet-enabled');
        this.settingPacketExcluded = document.getElementById('setting-packet-excluded');
        this.settingPauseOnExpand = document.getElementById('setting-pause-on-expand');

        // Settings read-only displays
        this.settingWsPort = document.getElementById('setting-ws-port');
        this.settingWsAddress = document.getElementById('setting-ws-address');
        this.settingWsMaxClients = document.getElementById('setting-ws-max-clients');

        // Inspector pause button
        this.inspectorPauseBtn = document.getElementById('inspector-pause-btn');
        this.inspectorPauseIcon = document.getElementById('inspector-pause-icon');
        this.inspectorPauseLabel = document.getElementById('inspector-pause-label');
        this.inspectorPaused = false;

        // Tab elements
        this.tabBtns = document.querySelectorAll('.tab-btn');
        this.tabEntities = document.getElementById('tab-entities');
        this.tabAssets = document.getElementById('tab-assets');

        // Asset browser elements
        this.categoryList = document.getElementById('category-list');
        this.assetListEl = document.getElementById('asset-list');
        this.assetDetailEl = document.getElementById('asset-detail');
        this.assetFilterInput = document.getElementById('asset-filter');
        this.searchModeToggle = document.getElementById('search-mode-toggle');
        this.patchBtn = document.getElementById('patch-btn');
        this.historyList = document.getElementById('history-list');

        // Patch modal elements
        this.patchModal = document.getElementById('patch-modal');
        this.patchModalClose = document.getElementById('patch-modal-close');
        this.patchBasePath = document.getElementById('patch-base-path');
        this.patchOperation = document.getElementById('patch-operation');
        this.testWildcardBtn = document.getElementById('test-wildcard-btn');
        this.wildcardMatchesRow = document.getElementById('wildcard-matches-row');
        this.wildcardMatches = document.getElementById('wildcard-matches');
        this.originalJson = document.getElementById('original-json');
        this.modifiedJson = document.getElementById('modified-json');
        this.directJson = document.getElementById('direct-json');
        this.patchPreview = document.getElementById('patch-preview');
        this.patchFilename = document.getElementById('patch-filename');
        this.draftStatus = document.getElementById('draft-status');
        this.saveDraftBtn = document.getElementById('save-draft-btn');
        this.publishBtn = document.getElementById('publish-btn');
        this.cancelPatchBtn = document.getElementById('cancel-patch-btn');
        this.patchEditorDiff = document.getElementById('patch-editor-diff');
        this.patchEditorJson = document.getElementById('patch-editor-json');
        this.modeBtns = document.querySelectorAll('.mode-btn');
        this.patchEditorMode = 'diff';

        // Header elements
        this.headerEl = document.getElementById('header');
        this.headerLogoSection = document.getElementById('header-logo-section');
        this.headerCollapsed = false;

        // Copy buttons
        this.inspectorCopyBtn = document.getElementById('inspector-copy-btn');

        // Initialize
        this.setupEventListeners();
        this.setupPacketLogListeners();
        this.setupSettingsListeners();
        this.setupHeaderToggle();
        this.setupTabListeners();
        this.setupAssetBrowserListeners();
        this.setupPatchModalListeners();
        this.loadHeaderState();
        this.loadCachedConfig();  // Load settings from localStorage as fallback
        this.connect();
        this.startUptimeTimer();
        this.startGlobalChangesCleanup();
    }

    // ═══════════════════════════════════════════════════════════════
    // WEBSOCKET CONNECTION
    // ═══════════════════════════════════════════════════════════════

    connect() {
        this.setStatus('connecting');
        this.log('Connecting to ws://localhost:8765...', 'connect');

        try {
            this.ws = new WebSocket('ws://localhost:8765');

            this.ws.onopen = () => {
                this.reconnectAttempts = 0;
                this.setStatus('connected');
                this.log('Connected to server', 'connect');
            };

            this.ws.onclose = () => {
                this.setStatus('disconnected');
                this.log('Disconnected from server', 'disconnect');
                this.scheduleReconnect();
            };

            this.ws.onerror = (err) => {
                console.error('WebSocket error:', err);
                this.log('Connection error', 'disconnect');
            };

            this.ws.onmessage = (event) => {
                this.handleMessage(event.data);
            };

        } catch (err) {
            console.error('Failed to connect:', err);
            this.setStatus('disconnected');
            this.scheduleReconnect();
        }
    }

    scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.log('Max reconnect attempts reached', 'disconnect');
            return;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.min(this.reconnectAttempts, 5);
        this.log(`Reconnecting in ${delay/1000}s (attempt ${this.reconnectAttempts})...`, 'disconnect');

        setTimeout(() => this.connect(), delay);
    }

    setStatus(status) {
        this.statusEl.className = `status ${status}`;
        const labels = {
            connected: '● CONNECTED',
            connecting: '◌ CONNECTING',
            disconnected: '● DISCONNECTED'
        };
        this.statusEl.textContent = labels[status] || status;
    }

    // ═══════════════════════════════════════════════════════════════
    // MESSAGE HANDLING
    // ═══════════════════════════════════════════════════════════════

    handleMessage(data) {
        try {
            const msg = JSON.parse(data);
            this.lastUpdate = Date.now();
            this.updateLastUpdateTime();

            switch (msg.type) {
                case 'INIT':
                    this.handleInit(msg.data);
                    break;
                case 'ENTITY_SPAWN':
                    this.handleSpawn(msg.data);
                    break;
                case 'ENTITY_DESPAWN':
                    this.handleDespawn(msg.data);
                    break;
                case 'ENTITY_UPDATE':
                    this.handleUpdate(msg.data);
                    break;
                case 'POSITION_BATCH':
                    this.handlePositionBatch(msg.data);
                    break;
                case 'PACKET_LOG':
                    this.handlePacketLog(msg.data);
                    break;
                case 'CONFIG_SYNC':
                    this.handleConfigSync(msg.data);
                    break;
                case 'EXPAND_RESPONSE':
                    this.handleExpandResponse(msg.data);
                    break;
                case 'PACKET_EXPAND_RESPONSE':
                    this.handlePacketExpandResponse(msg.data);
                    break;
                case 'ERROR':
                    this.handleError(msg.data);
                    break;

                // Asset browser messages
                case 'FEATURE_INFO':
                    this.handleFeatureInfo(msg.data);
                    break;
                case 'ASSET_CATEGORIES':
                    this.handleAssetCategories(msg.data);
                    break;
                case 'ASSET_LIST':
                    this.handleAssetList(msg.data);
                    break;
                case 'ASSET_DETAIL':
                    this.handleAssetDetail(msg.data);
                    break;
                case 'SEARCH_RESULTS':
                    this.handleSearchResults(msg.data);
                    break;
                case 'ASSET_EXPAND_RESPONSE':
                    this.handleAssetExpandResponse(msg.data);
                    break;

                // Patch messages
                case 'WILDCARD_MATCHES':
                    this.handleWildcardMatches(msg.data);
                    break;
                case 'PATCH_GENERATED':
                    this.handlePatchGenerated(msg.data);
                    break;
                case 'DRAFT_SAVED':
                    this.handleDraftSaved(msg.data);
                    break;
                case 'PATCH_PUBLISHED':
                    this.handlePatchPublished(msg.data);
                    break;
                case 'DRAFTS_LIST':
                    this.handleDraftsList(msg.data);
                    break;

                default:
                    console.log('Unknown message type:', msg.type);
            }
        } catch (err) {
            console.error('Failed to parse message:', err);
        }
    }

    handleInit(data) {
        this.entities.clear();
        this.worldName = data.worldName || data.worldId || '---';
        this.worldNameEl.textContent = this.worldName;

        if (data.entities && Array.isArray(data.entities)) {
            data.entities.forEach(entity => {
                this.entities.set(entity.entityId, this.normalizeEntityPosition(entity));
            });
        }

        this.log(`INIT: Received ${this.entities.size} entities`, 'connect');
        this.renderEntityList();
        this.updateEntityCount();
    }

    handleSpawn(entity) {
        entity = this.normalizeEntityPosition(entity);
        this.entities.set(entity.entityId, entity);
        this.log(`SPAWN: ${entity.modelAssetId || entity.entityType || 'Entity'} #${entity.entityId}`, 'spawn');
        this.renderEntityList();
        this.updateEntityCount();

        // Flash animation for new entity
        setTimeout(() => {
            const row = document.querySelector(`[data-entity-id="${entity.entityId}"]`);
            if (row) row.classList.add('spawned');
        }, 10);
    }

    handleDespawn(data) {
        const entityId = data.entityId;
        const entity = this.entities.get(entityId);
        const name = entity ? (entity.modelAssetId || entity.entityType || 'Entity') : 'Entity';

        this.log(`DESPAWN: ${name} #${entityId}`, 'despawn');

        // Animate removal
        const row = document.querySelector(`[data-entity-id="${entityId}"]`);
        if (row) {
            row.classList.add('despawning');
            setTimeout(() => {
                this.entities.delete(entityId);
                this.renderEntityList();
                this.updateEntityCount();

                // Clear inspector if this was selected
                if (this.selectedEntityId === entityId) {
                    this.selectedEntityId = null;
                    this.renderInspector();
                }
            }, 300);
        } else {
            this.entities.delete(entityId);
            this.renderEntityList();
            this.updateEntityCount();
        }
    }

    handleUpdate(data) {
        const entity = this.normalizeEntityPosition(data);
        const existing = this.entities.get(entity.entityId);
        this.entities.set(entity.entityId, entity);

        // Track changed components if provided
        if (data.changedComponents) {
            this.trackComponentChanges(entity.entityId, data.changedComponents);
        }

        // Flash the updated row
        const row = document.querySelector(`[data-entity-id="${entity.entityId}"]`);
        if (row) {
            row.classList.remove('updated');
            void row.offsetWidth; // Trigger reflow
            row.classList.add('updated');

            // Update position display
            const posEl = row.querySelector('.col-pos');
            if (posEl && entity.position) {
                posEl.textContent = this.formatPosition(entity.position);
            }
        }

        // Update inspector if selected (skip only if manually paused)
        if (this.selectedEntityId === entity.entityId && !this.inspectorPaused) {
            this.renderInspector();
        }
    }

    handlePositionBatch(positions) {
        if (!Array.isArray(positions)) return;

        positions.forEach(pos => {
            const entity = this.entities.get(pos.entityId);
            if (entity) {
                entity.position = { x: pos.x, y: pos.y, z: pos.z };

                // Also update TransformComponent if it exists (keeps inspector in sync)
                if (entity.components) {
                    const transform = entity.components.TransformComponent;
                    if (transform && transform.fields) {
                        transform.fields.position = [pos.x, pos.y, pos.z];
                    }
                }

                // Update display
                const row = document.querySelector(`[data-entity-id="${pos.entityId}"]`);
                if (row) {
                    const posEl = row.querySelector('.col-pos');
                    if (posEl) {
                        posEl.textContent = this.formatPosition(entity.position);
                    }
                }
            }
        });

        // Update inspector if showing position (skip only if manually paused)
        if (this.selectedEntityId && this.entities.has(this.selectedEntityId) && !this.inspectorPaused) {
            this.renderInspector();
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // PACKET LOG HANDLING
    // ═══════════════════════════════════════════════════════════════

    handlePacketLog(data) {
        if (this.packetLogPaused) return;

        // Add to packet log - use server-assigned ID if available
        const packet = {
            id: data.id || (Date.now() + Math.random()),  // Server ID for expand requests
            timestamp: data.timestamp || Date.now(),
            direction: data.direction || 'unknown',
            packetName: data.packetName || 'Unknown',
            packetId: data.packetId || -1,
            handlerName: data.handlerName || '',
            data: data.data || {}
        };

        this.packetLog.push(packet);

        // Trim to max size
        while (this.packetLog.length > this.maxPacketLogSize) {
            this.packetLog.shift();
        }

        // Always render new packets (live updates)
        this.renderPacketLog();
        this.updatePacketCount();
    }

    setupPacketLogListeners() {
        // Toggle panel collapse
        if (this.packetLogHeader) {
            this.packetLogHeader.addEventListener('click', (e) => {
                // Don't toggle if clicking controls
                if (e.target.closest('.packet-log-controls')) return;
                this.togglePacketLogPanel();
            });
        }

        // Pause/Resume button
        if (this.packetPauseBtn) {
            this.packetPauseBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.togglePacketLogPause();
            });
        }

        // Clear button
        if (this.packetClearBtn) {
            this.packetClearBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.packetLog = [];
                this.selectedPacket = null;
                this.renderPacketLog();
                this.renderPacketDetail();
                this.updatePacketCount();
            });
        }

        // Fullscreen button
        if (this.packetFullscreenBtn) {
            this.packetFullscreenBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.togglePacketFullscreen();
            });
        }

        // Filter input
        if (this.packetFilterInput) {
            this.packetFilterInput.addEventListener('input', (e) => {
                e.stopPropagation();
                this.packetLogFilter = e.target.value.trim().toLowerCase();
                this.renderPacketLog();
            });

            // Don't bubble clicks from filter input
            this.packetFilterInput.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }

        // Direction filter
        if (this.packetDirectionSelect) {
            this.packetDirectionSelect.addEventListener('change', (e) => {
                e.stopPropagation();
                this.packetDirectionFilter = e.target.value;
                this.renderPacketLog();
            });

            this.packetDirectionSelect.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }
    }

    togglePacketLogPanel() {
        this.packetLogCollapsed = !this.packetLogCollapsed;
        this.packetLogPanel.classList.toggle('collapsed', this.packetLogCollapsed);
    }

    togglePacketFullscreen() {
        this.packetLogFullscreen = !this.packetLogFullscreen;

        // Toggle fullscreen class on the packet panel
        this.packetLogPanel.classList.toggle('fullscreen', this.packetLogFullscreen);

        // Hide/show other panels
        if (this.entityListPanel) {
            this.entityListPanel.classList.toggle('hidden', this.packetLogFullscreen);
        }
        if (this.inspectorPanel) {
            this.inspectorPanel.classList.toggle('hidden', this.packetLogFullscreen);
        }
        if (this.resizeHandle) {
            this.resizeHandle.classList.toggle('hidden', this.packetLogFullscreen);
        }
        if (this.mainEl) {
            this.mainEl.classList.toggle('hidden', this.packetLogFullscreen);
        }

        // Update button icon
        if (this.packetFullscreenBtn) {
            this.packetFullscreenBtn.textContent = this.packetLogFullscreen ? '⤡' : '⤢';
            this.packetFullscreenBtn.title = this.packetLogFullscreen ? 'Exit Fullscreen (F)' : 'Toggle Fullscreen (F)';
        }

        // Expand panel if collapsed when entering fullscreen
        if (this.packetLogFullscreen && this.packetLogCollapsed) {
            this.packetLogCollapsed = false;
            this.packetLogPanel.classList.remove('collapsed');
        }

        this.log(`Packet log ${this.packetLogFullscreen ? 'fullscreen' : 'normal'}`, 'info');
    }

    /**
     * Copy a packet's full data to clipboard.
     * Expands all expandable fields before copying.
     */
    async copyPacketToClipboard(packetId, buttonEl = null) {
        const packet = this.packetLog.find(p => p.id === packetId);
        if (!packet) {
            this.log('Packet not found', 'error');
            return;
        }

        // Show loading state on button
        if (buttonEl) {
            buttonEl.textContent = '⏳';
            buttonEl.disabled = true;
        }

        try {
            // Find all expandable paths in the packet data
            const expandablePaths = this.findExpandablePaths(packet.data, 'data');

            // Request expansion for each path and wait for responses
            if (expandablePaths.length > 0) {
                this.log(`Expanding ${expandablePaths.length} fields...`, 'info');
                await this.expandAllPaths(packetId, expandablePaths);
            }

            // Build the complete packet object
            const packetCopy = {
                id: packet.id,
                direction: packet.direction,
                packetName: packet.packetName,
                packetId: packet.packetId,
                handlerName: packet.handlerName,
                timestamp: new Date(packet.timestamp).toISOString(),
                data: packet.data
            };

            const json = JSON.stringify(packetCopy, null, 2);
            await navigator.clipboard.writeText(json);

            // Show success feedback
            if (buttonEl) {
                buttonEl.textContent = '✓';
                buttonEl.classList.add('copied');
                setTimeout(() => {
                    buttonEl.textContent = '📋';
                    buttonEl.classList.remove('copied');
                    buttonEl.disabled = false;
                }, 1500);
            }

            this.log(`Copied packet ${packet.packetName} to clipboard`, 'info');
        } catch (err) {
            this.log('Failed to copy: ' + err.message, 'error');
            if (buttonEl) {
                buttonEl.textContent = '✗';
                setTimeout(() => {
                    buttonEl.textContent = '📋';
                    buttonEl.disabled = false;
                }, 1500);
            }
        }
    }

    /**
     * Find all paths with _expandable: true in an object.
     */
    findExpandablePaths(obj, basePath) {
        const paths = [];

        const traverse = (current, path) => {
            if (!current || typeof current !== 'object') return;

            // Check if this is an expandable marker
            if (current._expandable === true) {
                paths.push(path);
                return;
            }

            // Recurse into object properties
            for (const key of Object.keys(current)) {
                if (key.startsWith('_')) continue; // Skip meta fields
                traverse(current[key], `${path}.${key}`);
            }
        };

        traverse(obj, basePath);
        return paths;
    }

    /**
     * Expand all paths and wait for responses.
     */
    async expandAllPaths(packetId, paths) {
        // Create promises for each expansion request
        const promises = paths.map(path => {
            return new Promise((resolve) => {
                // Store the resolve function to be called when response arrives
                if (!this.pendingPacketExpands) {
                    this.pendingPacketExpands = new Map();
                }

                const key = `${packetId}:${path}`;
                this.pendingPacketExpands.set(key, resolve);

                // Send the request
                this.send('REQUEST_PACKET_EXPAND', { packetId, path });

                // Timeout after 5 seconds
                setTimeout(() => {
                    if (this.pendingPacketExpands.has(key)) {
                        this.pendingPacketExpands.delete(key);
                        resolve(null); // Resolve with null on timeout
                    }
                }, 5000);
            });
        });

        // Wait for all expansions to complete
        await Promise.all(promises);
    }

    renderPacketLog() {
        const filtered = this.getFilteredPackets();

        if (filtered.length === 0) {
            this.packetList.innerHTML = `
                <div class="empty-state">
                    <pre>${this.packetLogPaused ? 'Paused' : 'Waiting for packets...'}</pre>
                </div>`;
            return;
        }

        // Group consecutive packets of the same type
        const groups = this.groupPackets(filtered);

        const html = groups.map((group, idx) => {
            if (group.length === 1) {
                // Single packet - render as row
                const p = group[0];
                const isSelected = this.selectedPacket && this.selectedPacket.id === p.id;
                return `
                    <div class="packet-row ${p.direction} ${isSelected ? 'selected' : ''}"
                         data-packet-id="${p.id}">
                        <span class="packet-direction">${p.direction === 'inbound' ? '&#8594;' : '&#8592;'}</span>
                        <span class="packet-time">${this.formatPacketTime(p.timestamp)}</span>
                        <span class="packet-name">${escapeHtml(p.packetName)}</span>
                        <button class="packet-copy-btn" data-packet-id="${p.id}" title="Copy packet JSON">📋</button>
                    </div>
                `;
            } else {
                // Multiple packets - render as collapsible group
                const first = group[0];
                const isExpanded = first.expanded;
                return `
                    <div class="packet-group ${isExpanded ? 'expanded' : ''}" data-group-idx="${idx}">
                        <div class="packet-group-header ${first.direction}">
                            <span class="packet-group-toggle">&#9654;</span>
                            <span class="packet-direction">${first.direction === 'inbound' ? '&#8594;' : '&#8592;'}</span>
                            <span class="packet-time">${this.formatPacketTime(first.timestamp)}</span>
                            <span class="packet-name">${escapeHtml(first.packetName)}</span>
                            <span class="packet-group-count">&times;${group.length}</span>
                        </div>
                        <div class="packet-group-items">
                            ${group.map(p => {
                                const isSelected = this.selectedPacket && this.selectedPacket.id === p.id;
                                return `
                                    <div class="packet-row ${p.direction} ${isSelected ? 'selected' : ''}"
                                         data-packet-id="${p.id}">
                                        <span class="packet-time">${this.formatPacketTime(p.timestamp)}</span>
                                        <span class="packet-name">${escapeHtml(p.packetName)}</span>
                                        <button class="packet-copy-btn" data-packet-id="${p.id}" title="Copy packet JSON">📋</button>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                `;
            }
        }).join('');

        this.packetList.innerHTML = html;

        // Add click handlers
        this.packetList.querySelectorAll('.packet-row').forEach(row => {
            row.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = parseFloat(row.dataset.packetId);
                this.selectPacket(id);
            });
        });

        // Add group toggle handlers
        this.packetList.querySelectorAll('.packet-group-header').forEach(header => {
            header.addEventListener('click', (e) => {
                const group = header.parentElement;
                group.classList.toggle('expanded');
            });
        });

        // Add copy button handlers
        this.packetList.querySelectorAll('.packet-copy-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = parseFloat(btn.dataset.packetId);
                this.copyPacketToClipboard(id, btn);
            });
        });

        // Auto-scroll to bottom
        this.packetList.scrollTop = this.packetList.scrollHeight;
    }

    getFilteredPackets() {
        return this.packetLog.filter(p => {
            // Direction filter
            if (this.packetDirectionFilter !== 'all' && p.direction !== this.packetDirectionFilter) {
                return false;
            }
            // Text filter
            if (this.packetLogFilter) {
                const searchText = p.packetName.toLowerCase() + ' ' + p.handlerName.toLowerCase();
                if (!searchText.includes(this.packetLogFilter)) {
                    return false;
                }
            }
            return true;
        });
    }

    groupPackets(packets) {
        const groups = [];
        let currentGroup = [];
        let lastPacketName = null;
        let lastDirection = null;

        for (const p of packets) {
            if (p.packetName === lastPacketName && p.direction === lastDirection) {
                currentGroup.push(p);
            } else {
                if (currentGroup.length > 0) {
                    groups.push(currentGroup);
                }
                currentGroup = [p];
                lastPacketName = p.packetName;
                lastDirection = p.direction;
            }
        }

        if (currentGroup.length > 0) {
            groups.push(currentGroup);
        }

        return groups;
    }

    selectPacket(id) {
        this.selectedPacket = this.packetLog.find(p => p.id === id) || null;

        // Update selection in list
        this.packetList.querySelectorAll('.packet-row.selected').forEach(row => {
            row.classList.remove('selected');
        });

        if (this.selectedPacket) {
            const row = this.packetList.querySelector(`[data-packet-id="${id}"]`);
            if (row) row.classList.add('selected');
        }

        this.renderPacketDetail();
    }

    renderPacketDetail() {
        if (!this.selectedPacket) {
            this.packetDetail.innerHTML = `
                <div class="empty-state">
                    <pre>Click a packet to view details</pre>
                </div>`;
            return;
        }

        const p = this.selectedPacket;

        let html = `
            <div class="packet-detail-header">
                <div class="packet-detail-title">
                    <h3>${p.direction === 'inbound' ? '&#8594;' : '&#8592;'} ${escapeHtml(p.packetName)}</h3>
                    <button class="copy-btn" id="packet-copy-btn" title="Copy as JSON">&#128203;</button>
                </div>
                <div class="packet-detail-meta">
                    <div class="meta-row">
                        <span class="label">Direction:</span>
                        <span class="value ${p.direction}">${p.direction}</span>
                    </div>
                    <div class="meta-row">
                        <span class="label">Time:</span>
                        <span class="value">${new Date(p.timestamp).toLocaleTimeString()}.${p.timestamp % 1000}</span>
                    </div>
                    <div class="meta-row">
                        <span class="label">Packet ID:</span>
                        <span class="value">${p.packetId >= 0 ? p.packetId : 'N/A'}</span>
                    </div>
                    <div class="meta-row">
                        <span class="label">Handler:</span>
                        <span class="value">${escapeHtml(p.handlerName)}</span>
                    </div>
                </div>
            </div>
        `;

        // Render packet data
        if (p.data && Object.keys(p.data).length > 0) {
            html += `
                <div class="packet-data-section">
                    <h4>Packet Data</h4>
                    <div class="component-body">
            `;

            for (const [key, value] of Object.entries(p.data)) {
                html += this.renderProperty(key, value, 0, `data`);
            }

            html += `
                    </div>
                </div>
            `;
        } else {
            html += `
                <div class="packet-data-section">
                    <h4>Packet Data</h4>
                    <span style="color: var(--text-dim)">No data fields</span>
                </div>
            `;
        }

        this.packetDetail.innerHTML = html;

        // Add copy button handler
        const copyBtn = this.packetDetail.querySelector('#packet-copy-btn');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                this.copyPacketData();
            });
        }

        // Add expand handlers for packet fields
        this.packetDetail.querySelectorAll('.expandable').forEach(el => {
            el.addEventListener('click', () => {
                const path = el.dataset.path;
                if (path && this.selectedPacket) {
                    // Auto-pause packet log when expanding (keeps packet in cache)
                    if (!this.packetLogPaused && this.pauseOnExpand) {
                        this.togglePacketLogPause();
                    }
                    this.requestPacketExpand(this.selectedPacket.id, path);
                    el.classList.add('loading');
                    el.querySelector('.expand-icon').textContent = '...';
                }
            });
        });
    }

    formatPacketTime(timestamp) {
        const date = new Date(timestamp);
        const h = String(date.getHours()).padStart(2, '0');
        const m = String(date.getMinutes()).padStart(2, '0');
        const s = String(date.getSeconds()).padStart(2, '0');
        return `${h}:${m}:${s}`;
    }

    updatePacketCount() {
        const filtered = this.getFilteredPackets();
        this.packetCountEl.textContent = `${filtered.length} packets`;
    }

    // ═══════════════════════════════════════════════════════════════
    // SETTINGS HANDLING
    // ═══════════════════════════════════════════════════════════════

    handleError(data) {
        const message = data?.message || 'Unknown error';
        this.log(`Server error: ${message}`, 'disconnect');
        console.warn('Server error:', message);
    }

    handleConfigSync(data) {
        this.serverConfig = data;
        // Save to localStorage as backup
        localStorage.setItem('inspector-server-config', JSON.stringify(data));
        this.log('Received config sync from server', 'connect');
        this.populateSettingsForm();
    }

    /**
     * Load config from localStorage (fallback when server hasn't sent config yet)
     */
    loadCachedConfig() {
        const cached = localStorage.getItem('inspector-server-config');
        if (cached) {
            try {
                this.serverConfig = JSON.parse(cached);
                this.populateSettingsForm();
            } catch (e) {
                // Invalid JSON, ignore
            }
        }
    }

    setupSettingsListeners() {
        if (!this.settingsModal) return;

        // Toggle button in footer
        if (this.settingsToggleBtn) {
            this.settingsToggleBtn.addEventListener('click', () => {
                this.toggleSettings();
            });
        }

        // Close button
        if (this.settingsCloseBtn) {
            this.settingsCloseBtn.addEventListener('click', () => {
                this.closeSettings();
            });
        }

        // Apply button
        if (this.settingsApplyBtn) {
            this.settingsApplyBtn.addEventListener('click', () => {
                this.applySettings();
            });
        }

        // Cancel button
        if (this.settingsCancelBtn) {
            this.settingsCancelBtn.addEventListener('click', () => {
                this.closeSettings();
            });
        }

        // Close on overlay click
        const overlay = this.settingsModal.querySelector('.settings-overlay');
        if (overlay) {
            overlay.addEventListener('click', () => {
                this.closeSettings();
            });
        }

        // Prevent closing when clicking inside the panel
        const panel = this.settingsModal.querySelector('.settings-panel');
        if (panel) {
            panel.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }
    }

    toggleSettings() {
        if (this.settingsOpen) {
            this.closeSettings();
        } else {
            this.openSettings();
        }
    }

    openSettings() {
        this.settingsOpen = true;
        this.settingsModal.classList.remove('hidden');
        this.populateSettingsForm();
        this.settingsStatusEl.textContent = '';
    }

    closeSettings() {
        this.settingsOpen = false;
        this.settingsModal.classList.add('hidden');
    }

    populateSettingsForm() {
        if (!this.serverConfig) return;

        const cfg = this.serverConfig;

        // General settings
        this.settingEnabled.checked = cfg.enabled !== false;
        this.settingUpdateInterval.value = cfg.updateIntervalTicks || 3;
        this.settingMaxCached.value = cfg.maxCachedEntities || 5000;

        // Entity filters
        this.settingIncludeNPCs.checked = cfg.includeNPCs !== false;
        this.settingIncludePlayers.checked = cfg.includePlayers !== false;
        this.settingIncludeItems.checked = cfg.includeItems === true;

        // Packet log settings
        if (cfg.packetLog) {
            this.settingPacketEnabled.checked = cfg.packetLog.enabled !== false;
            this.settingPacketExcluded.value = (cfg.packetLog.excludedPackets || []).join(', ');
        }

        // WebSocket settings (read-only)
        if (cfg.websocket) {
            this.settingWsPort.textContent = cfg.websocket.port || 8765;
            this.settingWsAddress.textContent = cfg.websocket.bindAddress || '127.0.0.1';
            this.settingWsMaxClients.textContent = cfg.websocket.maxClients || 10;
        }

        // Local settings (not sent to server)
        if (this.settingPauseOnExpand) {
            this.settingPauseOnExpand.checked = this.pauseOnExpand;
        }
    }

    applySettings() {
        // Gather values from form
        const updates = {
            enabled: this.settingEnabled.checked,
            updateIntervalTicks: parseInt(this.settingUpdateInterval.value, 10) || 3,
            maxCachedEntities: parseInt(this.settingMaxCached.value, 10) || 5000,
            includeNPCs: this.settingIncludeNPCs.checked,
            includePlayers: this.settingIncludePlayers.checked,
            includeItems: this.settingIncludeItems.checked,
            packetLogEnabled: this.settingPacketEnabled.checked,
            packetLogExcluded: this.settingPacketExcluded.value
                .split(',')
                .map(s => s.trim())
                .filter(s => s)
        };

        // Save local settings
        if (this.settingPauseOnExpand) {
            this.pauseOnExpand = this.settingPauseOnExpand.checked;
            localStorage.setItem('inspector-pause-on-expand', this.pauseOnExpand);
        }

        // Update expandable states after settings change
        this.updateExpandableStates();

        // Send server settings
        this.sendConfigUpdate(updates);
        this.settingsStatusEl.textContent = 'Applying...';
        this.settingsStatusEl.style.color = 'var(--cyan)';

        // Show feedback and close after a moment
        setTimeout(() => {
            this.settingsStatusEl.textContent = 'Applied!';
            this.settingsStatusEl.style.color = 'var(--green)';
            setTimeout(() => {
                this.closeSettings();
            }, 500);
        }, 300);
    }

    sendConfigUpdate(updates) {
        this.send('CONFIG_UPDATE', updates);
        this.log('Sent config update to server', 'info');
    }

    // ═══════════════════════════════════════════════════════════════
    // HEADER TOGGLE
    // ═══════════════════════════════════════════════════════════════

    setupHeaderToggle() {
        if (this.headerLogoSection) {
            this.headerLogoSection.addEventListener('click', () => {
                this.toggleHeader();
            });
        }
    }

    loadHeaderState() {
        if (!this.headerEl) return;
        const collapsed = localStorage.getItem('inspector-header-collapsed') === 'true';
        if (collapsed) {
            this.headerCollapsed = true;
            this.headerEl.classList.add('collapsed');
        }
    }

    toggleHeader() {
        if (!this.headerEl) return;
        this.headerCollapsed = !this.headerCollapsed;
        this.headerEl.classList.toggle('collapsed', this.headerCollapsed);
        localStorage.setItem('inspector-header-collapsed', this.headerCollapsed);
    }

    toggleInspectorPause() {
        this.inspectorPaused = !this.inspectorPaused;

        // Update UI
        if (this.inspectorPauseBtn) {
            this.inspectorPauseBtn.classList.toggle('active', this.inspectorPaused);
        }
        if (this.inspectorPauseIcon) {
            this.inspectorPauseIcon.textContent = this.inspectorPaused ? '>' : '||';
        }
        if (this.inspectorPauseLabel) {
            this.inspectorPauseLabel.textContent = this.inspectorPaused ? 'RESUME' : 'PAUSE';
        }

        // Update expandable button states
        this.updateExpandableStates();

        this.log(`Inspector ${this.inspectorPaused ? 'paused' : 'resumed'}`, 'info');
    }

    togglePacketLogPause() {
        this.packetLogPaused = !this.packetLogPaused;

        // Update UI
        if (this.packetPauseIcon) {
            this.packetPauseIcon.textContent = this.packetLogPaused ? '>' : '||';
        }
        if (this.packetPauseBtn) {
            this.packetPauseBtn.classList.toggle('active', this.packetLogPaused);
        }

        // Render to show accumulated packets (when pauseOnExpand prevented updates)
        this.renderPacketLog();

        // Sync with server so it stops caching new packets
        this.send('SET_PAUSED', { paused: this.packetLogPaused });

        this.log(`Packet log ${this.packetLogPaused ? 'paused' : 'resumed'}`, 'info');
    }

    // ═══════════════════════════════════════════════════════════════
    // RENDERING
    // ═══════════════════════════════════════════════════════════════

    renderEntityList() {
        const filtered = this.getFilteredEntities();

        if (filtered.length === 0) {
            this.entityListEl.innerHTML = `
                <div class="empty-state">
                    <pre>
    ░░░░░░░░░░░░░░░░░░░░░
    ░  NO ENTITIES ${this.filter ? 'MATCH' : 'YET'}  ░
    ░   ${this.filter ? 'TRY DIFFERENT' : 'WAITING FOR'}     ░
    ░    ${this.filter ? 'FILTER' : 'CONNECTION'}          ░
    ░░░░░░░░░░░░░░░░░░░░░
                    </pre>
                </div>`;
            return;
        }

        // Sort by entityId
        filtered.sort((a, b) => a.entityId - b.entityId);

        const html = filtered.map(entity => {
            const isSelected = entity.entityId === this.selectedEntityId;
            return `
                <div class="entity-row ${isSelected ? 'selected' : ''}"
                     data-entity-id="${entity.entityId}">
                    <span class="col-id">#${entity.entityId}</span>
                    <span class="col-type">${escapeHtml(entity.entityType) || '---'}</span>
                    <span class="col-model">${escapeHtml(entity.modelAssetId) || '---'}</span>
                    <span class="col-pos">${this.formatPosition(entity.position)}</span>
                </div>
            `;
        }).join('');

        this.entityListEl.innerHTML = html;

        // Add click handlers
        this.entityListEl.querySelectorAll('.entity-row').forEach(row => {
            row.addEventListener('click', () => {
                const id = parseInt(row.dataset.entityId);
                this.selectEntity(id);
            });
        });
    }

    renderInspector() {
        if (!this.selectedEntityId || !this.entities.has(this.selectedEntityId)) {
            this.inspectorEl.innerHTML = `
                <div class="empty-state">
                    <pre>
    ╔════════════════════╗
    ║  SELECT AN ENTITY  ║
    ║   TO INSPECT ITS   ║
    ║    COMPONENTS      ║
    ╚════════════════════╝
                    </pre>
                </div>`;
            return;
        }

        const entity = this.entities.get(this.selectedEntityId);

        let html = `
            <div class="inspector-entity-header">
                <h2>▓ ${escapeHtml(entity.modelAssetId || entity.entityType || 'Entity')}</h2>
                <div class="inspector-meta">
                    <div class="inspector-meta-row">
                        <span class="label">ID:</span>
                        <span class="value">${entity.entityId}</span>
                    </div>
                    <div class="inspector-meta-row">
                        <span class="label">UUID:</span>
                        <span class="value">${escapeHtml(entity.uuid) || '---'}</span>
                    </div>
                    <div class="inspector-meta-row">
                        <span class="label">Type:</span>
                        <span class="value">${escapeHtml(entity.entityType) || '---'}</span>
                    </div>
                    <div class="inspector-meta-row">
                        <span class="label">Position:</span>
                        <span class="value">${this.formatPosition(entity.position, true)}</span>
                    </div>
                </div>
            </div>
        `;

        // Render components (filtered)
        if (entity.components && Object.keys(entity.components).length > 0) {
            const filteredComponents = Object.entries(entity.components)
                .filter(([name]) => this.componentMatchesFilter(name));

            if (filteredComponents.length > 0) {
                html += '<div class="components-list">';
                for (const [name, data] of filteredComponents) {
                    html += this.renderComponent(name, data);
                }
                html += '</div>';
            } else {
                html += `
                    <div class="empty-state" style="height: auto; padding: 20px;">
                        <pre>NO MATCHING COMPONENTS</pre>
                    </div>
                `;
            }
        } else {
            html += `
                <div class="empty-state" style="height: auto; padding: 20px;">
                    <pre>NO COMPONENTS</pre>
                </div>
            `;
        }

        this.inspectorEl.innerHTML = html;

        // Add toggle handlers
        this.inspectorEl.querySelectorAll('.component-header').forEach(header => {
            header.addEventListener('click', () => {
                const body = header.nextElementSibling;
                const toggle = header.querySelector('.toggle');
                if (body.classList.contains('collapsed')) {
                    body.classList.remove('collapsed');
                    toggle.textContent = '[-]';
                } else {
                    body.classList.add('collapsed');
                    toggle.textContent = '[+]';
                }
            });
        });

        // Add expand handlers for lazy loading
        this.inspectorEl.querySelectorAll('.expandable').forEach(el => {
            el.addEventListener('click', () => {
                const path = el.dataset.path;
                if (path && this.selectedEntityId) {
                    // Can only expand if paused or pauseOnExpand is enabled
                    if (!this.inspectorPaused && !this.pauseOnExpand) {
                        this.log('Enable "Auto-pause on Expand" in settings or pause manually', 'info');
                        return;
                    }
                    // Auto-pause when expanding (if not already paused)
                    if (!this.inspectorPaused && this.pauseOnExpand) {
                        this.toggleInspectorPause();
                    }
                    this.requestExpand(this.selectedEntityId, path);
                    el.classList.add('loading');
                    el.querySelector('.expand-icon').textContent = '...';
                }
            });
        });

        // Update expandable button states based on pause state
        this.updateExpandableStates();
    }

    /**
     * Update expandable button states based on pause state.
     */
    updateExpandableStates() {
        if (!this.inspectorEl) return;
        const canExpand = this.inspectorPaused || this.pauseOnExpand;
        this.inspectorEl.querySelectorAll('.expandable').forEach(el => {
            el.classList.toggle('disabled', !canExpand);
            el.title = canExpand ? 'Click to expand' : 'Enable "Auto-pause on Expand" or pause manually';
        });
    }

    renderComponent(name, data) {
        const props = data.data || data;
        const basePath = `components.${name}`;

        let propsHtml = '';
        for (const [key, value] of Object.entries(props)) {
            propsHtml += this.renderProperty(key, value, 0, basePath);
        }

        return `
            <div class="component-section">
                <div class="component-header">
                    <span class="toggle">[-]</span>
                    <span>${escapeHtml(name)}</span>
                </div>
                <div class="component-body">
                    ${propsHtml || '<span style="color: var(--text-dim)">Empty component</span>'}
                </div>
            </div>
        `;
    }

    renderProperty(key, value, depth = 0, path = '') {
        const indentStyle = `style="padding-left: ${depth * 16}px"`;
        const safeKey = escapeHtml(key);
        const currentPath = path ? `${path}.${key}` : key;

        if (value === null || value === undefined) {
            return `<div class="prop-row" ${indentStyle}><span class="prop-key">${safeKey}:</span><span class="prop-value">null</span></div>`;
        }

        if (typeof value === 'object' && !Array.isArray(value)) {
            // Check if this is an expandable (lazy-load) marker
            if (value._expandable) {
                const typeName = escapeHtml(value._type || 'Object');
                return `<div class="prop-row" ${indentStyle}>
                    <span class="prop-key">${safeKey}:</span>
                    <span class="prop-value expandable" data-path="${escapeHtml(currentPath)}" title="Click to expand">
                        [${typeName}] <span class="expand-icon">+</span>
                    </span>
                </div>`;
            }

            // Skip _type field in display (it's metadata)
            const entries = Object.entries(value).filter(([k]) => k !== '_type');
            if (entries.length === 0) {
                const typeName = value._type ? escapeHtml(value._type) : '{}';
                return `<div class="prop-row" ${indentStyle}><span class="prop-key">${safeKey}:</span><span class="prop-value">${typeName}</span></div>`;
            }

            const typeLabel = value._type ? ` <span class="type-hint">${escapeHtml(value._type)}</span>` : '';
            let html = `<div class="prop-row" ${indentStyle}><span class="prop-key">${safeKey}:</span><span class="prop-value">{${typeLabel}</span></div>`;
            for (const [k, v] of entries) {
                html += this.renderProperty(k, v, depth + 1, currentPath);
            }
            html += `<div class="prop-row" ${indentStyle}><span class="prop-value">}</span></div>`;
            return html;
        }

        if (Array.isArray(value)) {
            // Check if array contains objects (render each on separate line) or primitives
            if (value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
                let html = `<div class="prop-row" ${indentStyle}><span class="prop-key">${safeKey}:</span><span class="prop-value">[</span></div>`;
                value.forEach((item, idx) => {
                    html += this.renderProperty(String(idx), item, depth + 1, currentPath);
                });
                html += `<div class="prop-row" ${indentStyle}><span class="prop-value">]</span></div>`;
                return html;
            }
            const formatted = escapeHtml(value.map(v => typeof v === 'number' ? v.toFixed(2) : v).join(', '));
            return `<div class="prop-row" ${indentStyle}><span class="prop-key">${safeKey}:</span><span class="prop-value number">[${formatted}]</span></div>`;
        }

        let valueClass = 'prop-value';
        let displayValue = value;

        if (typeof value === 'number') {
            valueClass += ' number';
            displayValue = Number.isInteger(value) ? value : value.toFixed(4);
        } else if (typeof value === 'string') {
            valueClass += ' string';
            displayValue = `"${escapeHtml(value)}"`;
        } else if (typeof value === 'boolean') {
            valueClass += ' boolean';
            displayValue = value ? 'true' : 'false';
        } else {
            displayValue = escapeHtml(displayValue);
        }

        return `<div class="prop-row" ${indentStyle}><span class="prop-key">${safeKey}:</span><span class="${valueClass}">${displayValue}</span></div>`;
    }

    // ═══════════════════════════════════════════════════════════════
    // LAZY LOADING (EXPAND)
    // ═══════════════════════════════════════════════════════════════

    requestExpand(entityId, path) {
        this.send('REQUEST_EXPAND', { entityId, path });
        this.log(`Requesting expand: ${path}`, 'info');
    }

    requestPacketExpand(packetId, path) {
        this.send('REQUEST_PACKET_EXPAND', { packetId, path });
        this.log(`Requesting packet expand: ${path}`, 'info');
    }

    handleExpandResponse(data) {
        const { entityId, path, data: expandedData } = data;

        if (!expandedData) {
            this.log(`Expand failed for path: ${path}`, 'disconnect');
            return;
        }

        // Update the entity's data at the given path
        const entity = this.entities.get(entityId);
        if (!entity) return;

        // Navigate to the parent and set the value
        const parts = path.split('.');
        let current = entity;

        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            if (current[part] !== undefined) {
                current = current[part];
            } else if (current.data && current.data[part] !== undefined) {
                current = current.data[part];
            } else {
                return; // Path not found
            }
        }

        const lastKey = parts[parts.length - 1];
        if (current[lastKey] !== undefined) {
            current[lastKey] = expandedData;
        } else if (current.data && current.data[lastKey] !== undefined) {
            current.data[lastKey] = expandedData;
        }

        // Re-render if this entity is selected
        if (this.selectedEntityId === entityId) {
            this.renderInspector();
        }

        this.log(`Expanded: ${path}`, 'info');
    }

    handlePacketExpandResponse(data) {
        const { packetId, path, data: expandedData } = data;

        // Resolve any pending promise for copy operation
        const pendingKey = `${packetId}:${path}`;
        if (this.pendingPacketExpands && this.pendingPacketExpands.has(pendingKey)) {
            const resolve = this.pendingPacketExpands.get(pendingKey);
            this.pendingPacketExpands.delete(pendingKey);
            resolve(expandedData);
        }

        if (!expandedData) {
            this.log(`Packet expand failed for path: ${path}`, 'disconnect');
            return;
        }

        // Find the packet in our log
        const packet = this.packetLog.find(p => p.id === packetId);
        if (!packet) return;

        // Navigate to the parent and set the value
        const parts = path.split('.');
        let current = packet;

        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            if (current[part] !== undefined) {
                current = current[part];
            } else {
                return; // Path not found
            }
        }

        const lastKey = parts[parts.length - 1];
        if (current[lastKey] !== undefined) {
            current[lastKey] = expandedData;
        }

        // Re-render if this packet is selected
        if (this.selectedPacket && this.selectedPacket.id === packetId) {
            this.renderPacketDetail();
        }

        this.log(`Packet expanded: ${path}`, 'info');
    }

    // ═══════════════════════════════════════════════════════════════
    // COPY TO CLIPBOARD
    // ═══════════════════════════════════════════════════════════════

    /**
     * Copy the selected entity's component data as formatted JSON.
     */
    copyInspectorData() {
        if (!this.selectedEntityId || !this.entities.has(this.selectedEntityId)) {
            return;
        }

        const entity = this.entities.get(this.selectedEntityId);
        const data = {
            entityId: entity.entityId,
            uuid: entity.uuid,
            entityType: entity.entityType,
            modelAssetId: entity.modelAssetId,
            position: entity.position,
            components: entity.components
        };

        this.copyToClipboard(data, this.inspectorCopyBtn);
    }

    /**
     * Copy the selected packet's data as formatted JSON.
     */
    copyPacketData() {
        if (!this.selectedPacket) {
            return;
        }

        const btn = this.packetDetail.querySelector('.copy-btn');
        this.copyToClipboard(this.selectedPacket, btn);
    }

    /**
     * Copy data to clipboard as formatted JSON.
     */
    copyToClipboard(data, button) {
        const json = JSON.stringify(data, null, 2);

        navigator.clipboard.writeText(json).then(() => {
            // Show feedback
            if (button) {
                const originalText = button.textContent;
                button.textContent = '✓';
                button.classList.add('copied');
                setTimeout(() => {
                    button.textContent = originalText;
                    button.classList.remove('copied');
                }, 1500);
            }
            this.log('Copied to clipboard', 'info');
        }).catch(err => {
            console.error('Failed to copy:', err);
            this.log('Failed to copy to clipboard', 'disconnect');
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // HELPERS
    // ═══════════════════════════════════════════════════════════════

    /**
     * Normalize entity position data structure.
     * Backend sends entity.x/y/z directly, but code expects entity.position.x/y/z
     */
    normalizeEntityPosition(entity) {
        if (entity.x !== undefined && !entity.position) {
            entity.position = { x: entity.x, y: entity.y, z: entity.z };
        }
        return entity;
    }

    /**
     * Track component changes globally across all entities.
     */
    trackComponentChanges(entityId, changedComponents) {
        if (!changedComponents || !changedComponents.length) return;

        const entity = this.entities.get(entityId);
        const entityName = entity ? (entity.modelAssetId || entity.entityType || 'Entity') : 'Entity';
        const now = Date.now();

        // Filter out ignored/noisy components and add to global list
        changedComponents
            .filter(name => !this.ignoredComponents.has(name))
            .forEach(name => {
                this.globalChanges.push({
                    entityId,
                    entityName,
                    componentName: name,
                    timestamp: now
                });
            });

        // Clean up old changes and limit size
        this.globalChanges = this.globalChanges
            .filter(c => now - c.timestamp < this.chipRetentionMs)
            .slice(-this.maxGlobalChips * 2); // Keep some buffer

        this.updateChangedComponentsHeader();
    }

    /**
     * Update the global changed components header display.
     */
    updateChangedComponentsHeader() {
        const now = Date.now();

        // Filter to recent changes only
        const recent = this.globalChanges.filter(c => now - c.timestamp < this.chipRetentionMs);

        if (recent.length === 0) {
            this.changedHeaderEl.classList.add('hidden');
            return;
        }

        this.changedHeaderEl.classList.remove('hidden');

        // Deduplicate by entity+component (keep most recent), then take last N
        const seen = new Map();
        recent.forEach(c => seen.set(`${c.entityId}:${c.componentName}`, c));
        const uniqueChanges = Array.from(seen.values())
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, this.maxGlobalChips);

        this.componentChipsEl.innerHTML = uniqueChanges
            .map(c => `<span class="component-chip" title="${escapeHtml(c.entityName)} #${c.entityId}">${escapeHtml(c.entityName)}.${escapeHtml(c.componentName)}</span>`)
            .join('');
    }

    formatPosition(pos, full = false) {
        if (!pos) return '---';
        if (full) {
            return `X: ${pos.x.toFixed(2)}, Y: ${pos.y.toFixed(2)}, Z: ${pos.z.toFixed(2)}`;
        }
        return `${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}`;
    }

    getFilteredEntities() {
        if (!this.filter) {
            return Array.from(this.entities.values());
        }

        const search = this.filter.toLowerCase();
        return Array.from(this.entities.values()).filter(entity => {
            const type = (entity.entityType || '').toLowerCase();
            const model = (entity.modelAssetId || '').toLowerCase();
            const id = String(entity.entityId);
            return type.includes(search) || model.includes(search) || id.includes(search);
        });
    }

    /**
     * Check if a component name matches the component filter.
     * Supports comma-separated partial matches (e.g., "interaction, action, npc")
     */
    componentMatchesFilter(componentName) {
        if (!this.componentFilter) {
            return true; // No filter = show all
        }

        const nameLower = componentName.toLowerCase();
        const filters = this.componentFilter.split(',').map(f => f.trim()).filter(f => f);

        // Match if component name contains any of the filter terms
        return filters.some(filter => nameLower.includes(filter));
    }

    selectEntity(entityId) {
        // Deselect previous
        document.querySelectorAll('.entity-row.selected').forEach(row => {
            row.classList.remove('selected');
        });

        this.selectedEntityId = entityId;

        // Select new
        const row = document.querySelector(`[data-entity-id="${entityId}"]`);
        if (row) {
            row.classList.add('selected');
        }

        this.renderInspector();
    }

    updateEntityCount() {
        this.entityCountEl.textContent = this.entities.size;
    }

    updateLastUpdateTime() {
        if (this.lastUpdate) {
            const now = new Date();
            const time = now.toTimeString().split(' ')[0];
            this.lastUpdateEl.textContent = `Last update: ${time}`;
        }
    }

    startUptimeTimer() {
        setInterval(() => {
            const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
            const hours = Math.floor(elapsed / 3600);
            const minutes = Math.floor((elapsed % 3600) / 60);
            const seconds = elapsed % 60;
            this.uptimeEl.textContent = [hours, minutes, seconds]
                .map(n => String(n).padStart(2, '0'))
                .join(':');
        }, 1000);
    }

    startGlobalChangesCleanup() {
        // Periodically clean up and refresh the global changes header
        setInterval(() => {
            const now = Date.now();
            const before = this.globalChanges.length;
            this.globalChanges = this.globalChanges.filter(c => now - c.timestamp < this.chipRetentionMs);

            // Refresh display if changes were removed
            if (this.globalChanges.length !== before || this.globalChanges.length > 0) {
                this.updateChangedComponentsHeader();
            }
        }, 1000);
    }

    log(message, type = 'info') {
        const time = new Date().toTimeString().split(' ')[0];
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        // Note: message should already be escaped by caller, but escape again for safety
        entry.innerHTML = `<span class="time">${time}</span>${escapeHtml(message)}`;
        this.logContent.insertBefore(entry, this.logContent.firstChild);

        // Keep only last 100 entries
        while (this.logContent.children.length > 100) {
            this.logContent.removeChild(this.logContent.lastChild);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // EVENT LISTENERS
    // ═══════════════════════════════════════════════════════════════

    setupEventListeners() {
        // Entity search/filter
        this.searchInput.addEventListener('input', (e) => {
            this.filter = e.target.value.trim();
            this.renderEntityList();
        });

        // Component filter
        this.componentFilterInput.addEventListener('input', (e) => {
            this.componentFilter = e.target.value.trim().toLowerCase();
            this.renderInspector();
        });

        // Inspector copy button
        if (this.inspectorCopyBtn) {
            this.inspectorCopyBtn.addEventListener('click', () => {
                this.copyInspectorData();
            });
        }

        // Inspector pause button
        if (this.inspectorPauseBtn) {
            this.inspectorPauseBtn.addEventListener('click', () => {
                this.toggleInspectorPause();
            });
        }

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Don't capture when typing in input fields
            const isInputField = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
            if (isInputField && e.key !== 'Escape') {
                return;
            }

            // Close settings on Escape
            if (e.key === 'Escape' && this.settingsOpen) {
                this.closeSettings();
                return;
            }

            switch (e.key.toLowerCase()) {
                case 'r':
                    // Reconnect
                    if (this.ws) {
                        this.ws.close();
                    }
                    this.connect();
                    break;

                case 'c':
                    // Clear everything (local only)
                    this.entities.clear();
                    this.selectedEntityId = null;
                    this.packetLog = [];
                    this.selectedPacket = null;
                    this.renderEntityList();
                    this.renderInspector();
                    this.renderPacketLog();
                    this.renderPacketDetail();
                    this.updateEntityCount();
                    this.updatePacketCount();
                    this.log('Cleared all local data', 'info');
                    break;

                case 'escape':
                    // Deselect
                    this.selectedEntityId = null;
                    this.renderEntityList();
                    this.renderInspector();
                    this.searchInput.blur();
                    break;

                case 'l':
                    // Toggle event log
                    this.eventLog.classList.toggle('hidden');
                    break;

                case 'p':
                    // Toggle packet log panel
                    this.togglePacketLogPanel();
                    break;

                case 'f':
                    // Toggle packet fullscreen
                    this.togglePacketFullscreen();
                    break;

                case 's':
                    // Toggle settings
                    this.toggleSettings();
                    break;

                case ' ':
                    // Toggle inspector pause
                    e.preventDefault();
                    this.toggleInspectorPause();
                    break;

                case 'h':
                    // Toggle header
                    this.toggleHeader();
                    break;

                case '/':
                    // Focus search (context-aware)
                    e.preventDefault();
                    if (this.activeTab === 'assets' && this.assetFilterInput) {
                        this.assetFilterInput.focus();
                    } else {
                        this.searchInput.focus();
                    }
                    break;

                case 'a':
                    // Switch to Assets tab
                    this.switchTab('assets');
                    break;

                case 'e':
                    // Switch to Entities tab
                    this.switchTab('entities');
                    break;
            }
        });

        // Request snapshot button (if you add one)
        // Would send: this.ws.send(JSON.stringify({ type: 'REQUEST_SNAPSHOT' }));
    }

    // Send message to server
    send(type, data = {}) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type, data }));
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // TAB MANAGEMENT
    // ═══════════════════════════════════════════════════════════════

    setupTabListeners() {
        this.tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                this.switchTab(btn.dataset.tab);
            });
        });
    }

    switchTab(tabName) {
        this.activeTab = tabName;

        // Update tab buttons
        this.tabBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
        });

        // Update tab content
        if (this.tabEntities) {
            this.tabEntities.classList.toggle('active', tabName === 'entities');
        }
        if (this.tabAssets) {
            this.tabAssets.classList.toggle('active', tabName === 'assets');
        }

        // Request asset categories when switching to assets tab
        if (tabName === 'assets' && this.assetCategories.length === 0) {
            this.requestAssetCategories();
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // ASSET BROWSER
    // ═══════════════════════════════════════════════════════════════

    setupAssetBrowserListeners() {
        // Asset filter
        if (this.assetFilterInput) {
            this.assetFilterInput.addEventListener('input', (e) => {
                this.assetFilter = e.target.value.trim();
                if (this.searchMode === 'global' && this.assetFilter.length >= 2) {
                    this.requestSearchAssets(this.assetFilter);
                } else if (this.selectedCategory) {
                    this.requestAssets(this.selectedCategory, this.assetFilter);
                }
            });
        }

        // Search mode toggle
        if (this.searchModeToggle) {
            this.searchModeToggle.addEventListener('click', () => {
                this.toggleSearchMode();
            });
        }

        // Patch button
        if (this.patchBtn) {
            this.patchBtn.addEventListener('click', () => {
                this.openPatchModal();
            });
        }
    }

    toggleSearchMode() {
        this.searchMode = this.searchMode === 'category' ? 'global' : 'category';
        if (this.searchModeToggle) {
            this.searchModeToggle.classList.toggle('global', this.searchMode === 'global');
            this.searchModeToggle.title = this.searchMode === 'global'
                ? 'Global search (click to switch to category)'
                : 'Category filter (click to switch to global search)';
        }

        // Trigger search if filter is set
        if (this.assetFilter) {
            if (this.searchMode === 'global' && this.assetFilter.length >= 2) {
                this.requestSearchAssets(this.assetFilter);
            } else if (this.selectedCategory) {
                this.requestAssets(this.selectedCategory, this.assetFilter);
            }
        }
    }

    // Request methods
    requestAssetCategories() {
        this.send('REQUEST_ASSET_CATEGORIES');
    }

    requestAssets(category, filter = null) {
        this.send('REQUEST_ASSETS', { category, filter });
    }

    requestAssetDetail(category, assetId) {
        this.send('REQUEST_ASSET_DETAIL', { category, assetId });
    }

    requestSearchAssets(query) {
        this.send('REQUEST_SEARCH_ASSETS', { query });
    }

    // Handle messages
    handleFeatureInfo(data) {
        this.hytalorEnabled = data.hytalorEnabled || false;
        this.draftDirectory = data.draftDirectory;
        this.patchDirectory = data.patchDirectory;
        this.patchAssetPackName = data.patchAssetPackName;

        // Show/hide patch button based on Hytalor status
        if (this.patchBtn) {
            this.patchBtn.classList.toggle('hidden', !this.hytalorEnabled);
        }

        const packInfo = this.patchAssetPackName ? ` (saving to: ${this.patchAssetPackName})` : '';
        this.log(`Feature info: Hytalor ${this.hytalorEnabled ? 'enabled' : 'disabled'}${packInfo}`, 'info');
    }

    handleAssetCategories(data) {
        this.assetCategories = data.categories || [];
        this.renderAssetCategories();
    }

    handleAssetList(data) {
        this.assets = data.assets || [];
        this.renderAssetList();
    }

    handleAssetDetail(data) {
        this.assetDetail = data;
        this.renderAssetDetail();
    }

    handleSearchResults(data) {
        this.assets = data.results || [];
        this.renderAssetList();
    }

    handleAssetExpandResponse(data) {
        // Similar to entity expand - update the asset detail
        if (this.assetDetail && data.assetId === this.assetDetail.id) {
            // Update the content at the given path
            this.setNestedValue(this.assetDetail.content, data.path, data.data);
            this.renderAssetDetail();
        }
    }

    // Render methods
    renderAssetCategories() {
        if (!this.categoryList) return;

        if (this.assetCategories.length === 0) {
            this.categoryList.innerHTML = `
                <div class="empty-state small">
                    <pre>No categories found</pre>
                </div>`;
            return;
        }

        // Group by package
        const groups = {};
        for (const cat of this.assetCategories) {
            const group = cat.packageGroup || 'Other';
            if (!groups[group]) {
                groups[group] = [];
            }
            groups[group].push(cat);
        }

        let html = '';
        for (const [groupName, categories] of Object.entries(groups)) {
            html += `
                <div class="category-group">
                    <div class="category-group-header">
                        <span class="category-group-toggle">▼</span>
                        ${escapeHtml(groupName)}
                    </div>
                    <div class="category-items">
            `;

            for (const cat of categories) {
                const isSelected = this.selectedCategory === cat.id;
                html += `
                    <div class="category-item ${isSelected ? 'selected' : ''}" data-category="${escapeHtml(cat.id)}">
                        <span>${escapeHtml(cat.displayName)}</span>
                        <span class="category-count">${cat.count}</span>
                    </div>
                `;
            }

            html += `
                    </div>
                </div>
            `;
        }

        this.categoryList.innerHTML = html;

        // Add click handlers
        this.categoryList.querySelectorAll('.category-group-header').forEach(header => {
            header.addEventListener('click', () => {
                header.parentElement.classList.toggle('collapsed');
            });
        });

        this.categoryList.querySelectorAll('.category-item').forEach(item => {
            item.addEventListener('click', () => {
                this.selectCategory(item.dataset.category);
            });
        });
    }

    selectCategory(categoryId) {
        this.selectedCategory = categoryId;
        this.selectedAsset = null;
        this.assetDetail = null;

        // Update selection UI
        this.categoryList.querySelectorAll('.category-item').forEach(item => {
            item.classList.toggle('selected', item.dataset.category === categoryId);
        });

        // Request assets
        this.requestAssets(categoryId, this.assetFilter);
        this.renderAssetDetail(); // Clear detail
    }

    renderAssetList() {
        if (!this.assetListEl) return;

        if (this.assets.length === 0) {
            this.assetListEl.innerHTML = `
                <div class="empty-state small">
                    <pre>${this.selectedCategory ? 'No assets found' : 'Select a category'}</pre>
                </div>`;
            return;
        }

        const html = this.assets.map(asset => {
            const isSelected = this.selectedAsset === asset.id;
            return `
                <div class="asset-item ${isSelected ? 'selected' : ''}" data-asset-id="${escapeHtml(asset.id)}" data-category="${escapeHtml(asset.category)}">
                    <span class="asset-id">${escapeHtml(asset.id)}</span>
                    <span class="asset-type-hint">${escapeHtml(asset.typeHint || '')}</span>
                </div>
            `;
        }).join('');

        this.assetListEl.innerHTML = html;

        // Add click handlers
        this.assetListEl.querySelectorAll('.asset-item').forEach(item => {
            item.addEventListener('click', () => {
                this.selectAsset(item.dataset.category, item.dataset.assetId);
            });
        });
    }

    selectAsset(category, assetId) {
        this.selectedAsset = assetId;
        this.selectedCategory = category;

        // Update selection UI
        this.assetListEl.querySelectorAll('.asset-item').forEach(item => {
            item.classList.toggle('selected', item.dataset.assetId === assetId);
        });

        // Request detail
        this.requestAssetDetail(category, assetId);
    }

    renderAssetDetail() {
        if (!this.assetDetailEl) return;

        if (!this.assetDetail) {
            this.assetDetailEl.innerHTML = `
                <div class="empty-state">
                    <pre>Select an asset to view details</pre>
                </div>`;
            return;
        }

        let html = `
            <div class="asset-detail-header">
                <h3>▓ ${escapeHtml(this.assetDetail.id)}</h3>
                <div class="asset-meta">
                    <span class="label">Category:</span>
                    <span class="value">${escapeHtml(this.assetDetail.category)}</span>
                </div>
            </div>
            <div class="asset-content">
        `;

        // Render content as tree
        if (this.assetDetail.content) {
            for (const [key, value] of Object.entries(this.assetDetail.content)) {
                if (key.startsWith('_')) continue; // Skip meta fields
                html += this.renderProperty(key, value, 0, 'content');
            }
        }

        html += '</div>';

        this.assetDetailEl.innerHTML = html;

        // Add expand handlers
        this.assetDetailEl.querySelectorAll('.expandable').forEach(el => {
            el.addEventListener('click', () => {
                const path = el.dataset.path;
                if (path) {
                    this.send('REQUEST_ASSET_EXPAND', {
                        category: this.assetDetail.category,
                        assetId: this.assetDetail.id,
                        path
                    });
                    el.classList.add('loading');
                    el.querySelector('.expand-icon').textContent = '...';
                }
            });
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // PATCH MODAL
    // ═══════════════════════════════════════════════════════════════

    setupPatchModalListeners() {
        // Close button
        if (this.patchModalClose) {
            this.patchModalClose.addEventListener('click', () => this.closePatchModal());
        }
        if (this.cancelPatchBtn) {
            this.cancelPatchBtn.addEventListener('click', () => this.closePatchModal());
        }

        // Overlay click
        const overlay = this.patchModal?.querySelector('.modal-overlay');
        if (overlay) {
            overlay.addEventListener('click', () => this.closePatchModal());
        }

        // Mode toggle
        this.modeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                this.setPatchEditorMode(btn.dataset.mode);
            });
        });

        // Test wildcard
        if (this.testWildcardBtn) {
            this.testWildcardBtn.addEventListener('click', () => {
                const pattern = this.patchBasePath?.value;
                if (pattern && pattern.includes('*')) {
                    this.send('REQUEST_TEST_WILDCARD', { pattern });
                }
            });
        }

        // Modified JSON change - update preview
        if (this.modifiedJson) {
            this.modifiedJson.addEventListener('input', () => {
                this.updatePatchPreview();
            });
        }

        // Direct JSON change - update preview
        if (this.directJson) {
            this.directJson.addEventListener('input', () => {
                this.updatePatchPreviewDirect();
            });
        }

        // Save draft
        if (this.saveDraftBtn) {
            this.saveDraftBtn.addEventListener('click', () => this.saveDraft());
        }

        // Publish
        if (this.publishBtn) {
            this.publishBtn.addEventListener('click', () => this.publishPatch());
        }
    }

    openPatchModal() {
        if (!this.assetDetail) {
            this.log('No asset selected', 'disconnect');
            return;
        }

        // Determine BaseAssetPath - the ID is already the full path for file-based assets
        // Hytalor expects paths WITHOUT .json extension (e.g., "Entity/Effects/Food/Buff/FruitVeggie_Buff_T1")
        let basePath = this.assetDetail.id;
        // If ID doesn't contain slashes, prepend category
        if (!basePath.includes('/')) {
            basePath = `${this.assetDetail.category}/${basePath}`;
        }
        // Remove .json extension if present (shouldn't be, but just in case)
        basePath = basePath.replace(/\.json$/i, '');

        // Populate modal
        if (this.patchBasePath) {
            this.patchBasePath.value = basePath;
        }

        // Set original JSON
        const originalContent = this.assetDetail.rawJson || JSON.stringify(this.assetDetail.content, null, 2);
        if (this.originalJson) {
            this.originalJson.textContent = originalContent;
        }
        if (this.modifiedJson) {
            this.modifiedJson.value = originalContent;
        }

        // Generate filename from asset name (last part of path)
        const assetName = basePath.includes('/') ? basePath.split('/').pop() : basePath;
        if (this.patchFilename) {
            this.patchFilename.value = `${assetName}_patch.json`;
        }

        // Clear preview and status
        if (this.patchPreview) {
            this.patchPreview.textContent = '';
        }
        if (this.draftStatus) {
            this.draftStatus.textContent = '';
            this.draftStatus.className = 'draft-status';
        }

        // Show modal
        if (this.patchModal) {
            this.patchModal.classList.remove('hidden');
        }
    }

    closePatchModal() {
        if (this.patchModal) {
            this.patchModal.classList.add('hidden');
        }
    }

    setPatchEditorMode(mode) {
        this.patchEditorMode = mode;

        // Update mode buttons
        this.modeBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });

        // Show/hide editor panes
        if (this.patchEditorDiff) {
            this.patchEditorDiff.classList.toggle('hidden', mode !== 'diff');
        }
        if (this.patchEditorJson) {
            this.patchEditorJson.classList.toggle('hidden', mode !== 'json');
        }
    }

    updatePatchPreview() {
        if (this.patchEditorMode !== 'diff') return;

        try {
            const originalText = this.originalJson?.textContent || '{}';
            const modifiedText = this.modifiedJson?.value || '{}';

            const original = JSON.parse(originalText);
            const modified = JSON.parse(modifiedText);

            // Request server to generate patch
            this.send('REQUEST_GENERATE_PATCH', {
                baseAssetPath: this.patchBasePath?.value || '',
                original,
                modified,
                operation: this.patchOperation?.value || 'merge'
            });

        } catch (e) {
            if (this.patchPreview) {
                this.patchPreview.textContent = `Error: ${e.message}`;
            }
        }
    }

    updatePatchPreviewDirect() {
        if (this.patchEditorMode !== 'json') return;

        try {
            const patchText = this.directJson?.value || '';
            const patch = JSON.parse(patchText);
            if (this.patchPreview) {
                this.patchPreview.textContent = JSON.stringify(patch, null, 2);
            }
        } catch (e) {
            if (this.patchPreview) {
                this.patchPreview.textContent = `Error: ${e.message}`;
            }
        }
    }

    handleWildcardMatches(data) {
        if (!this.wildcardMatchesRow || !this.wildcardMatches) return;

        const matches = data.matches || [];
        if (matches.length === 0) {
            this.wildcardMatchesRow.style.display = 'none';
            return;
        }

        this.wildcardMatchesRow.style.display = 'flex';
        this.wildcardMatches.innerHTML = matches.map(m =>
            `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`
        ).join('');
    }

    handlePatchGenerated(data) {
        if (this.patchPreview) {
            if (data.error) {
                this.patchPreview.textContent = `Error: ${data.error}`;
            } else {
                this.patchPreview.textContent = data.patchJson || 'No changes';
            }
        }
    }

    handleDraftSaved(data) {
        if (this.draftStatus) {
            if (data.success) {
                this.draftStatus.textContent = `✓ Draft saved: ${data.filename}`;
                this.draftStatus.className = 'draft-status saved';
                this.addToHistory(data.filename, 'draft');
            } else {
                this.draftStatus.textContent = `✗ Error: ${data.error}`;
                this.draftStatus.className = 'draft-status error';
            }
        }
    }

    handlePatchPublished(data) {
        console.log('handlePatchPublished - received:', data);
        if (this.draftStatus) {
            if (data.success) {
                this.draftStatus.textContent = `✓ Published: ${data.filename}`;
                this.draftStatus.className = 'draft-status saved';
                this.addToHistory(data.filename, 'publish');
                // Close modal after successful publish
                setTimeout(() => this.closePatchModal(), 1500);
            } else {
                this.draftStatus.textContent = `✗ Error: ${data.error}`;
                this.draftStatus.className = 'draft-status error';
            }
        }
    }

    handleDraftsList(data) {
        // Could be used for a drafts list UI
        console.log('Drafts:', data.drafts);
    }

    saveDraft() {
        const filename = this.patchFilename?.value || 'patch.json';
        let patchJson;

        if (this.patchEditorMode === 'json') {
            patchJson = this.directJson?.value?.trim() || '';
        } else {
            patchJson = this.patchPreview?.textContent?.trim() || '';
        }

        console.log('saveDraft - patchJson:', patchJson);

        if (!patchJson || patchJson.startsWith('Error') || patchJson === 'No changes') {
            if (this.draftStatus) {
                this.draftStatus.textContent = `Cannot save: ${!patchJson ? 'empty patch' : patchJson.startsWith('Error') ? 'error in patch' : 'no changes detected'}`;
                this.draftStatus.className = 'draft-status error';
            }
            return;
        }

        this.send('REQUEST_SAVE_DRAFT', { filename, patchJson });
    }

    publishPatch() {
        const filename = this.patchFilename?.value || 'patch.json';
        let patchJson;

        if (this.patchEditorMode === 'json') {
            patchJson = this.directJson?.value?.trim() || '';
        } else {
            patchJson = this.patchPreview?.textContent?.trim() || '';
        }

        // Debug logging
        console.log('publishPatch - mode:', this.patchEditorMode);
        console.log('publishPatch - patchPreview element:', this.patchPreview);
        console.log('publishPatch - patchJson:', patchJson);
        console.log('publishPatch - patchJson length:', patchJson?.length);

        if (!patchJson || patchJson.startsWith('Error') || patchJson === 'No changes') {
            if (this.draftStatus) {
                this.draftStatus.textContent = `Cannot publish: ${!patchJson ? 'empty patch' : patchJson.startsWith('Error') ? 'error in patch' : 'no changes detected'}`;
                this.draftStatus.className = 'draft-status error';
            }
            return;
        }

        console.log('publishPatch - sending REQUEST_PUBLISH_PATCH with filename:', filename);
        this.send('REQUEST_PUBLISH_PATCH', { filename, patchJson });
    }

    addToHistory(filename, operation) {
        const entry = {
            filename,
            baseAssetPath: this.patchBasePath?.value || 'unknown',
            timestamp: Date.now(),
            operation
        };

        this.sessionHistory.unshift(entry);
        if (this.sessionHistory.length > 50) {
            this.sessionHistory.pop();
        }

        this.renderHistory();
    }

    renderHistory() {
        if (!this.historyList) return;

        if (this.sessionHistory.length === 0) {
            this.historyList.innerHTML = `
                <div class="empty-state small">
                    <pre>No patches yet</pre>
                </div>`;
            return;
        }

        const html = this.sessionHistory.map(entry => {
            const time = new Date(entry.timestamp).toLocaleTimeString();
            return `
                <div class="history-item">
                    <div class="filename">${escapeHtml(entry.filename)}</div>
                    <div class="meta">
                        <span class="time">${time}</span>
                        <span class="operation ${entry.operation}">${entry.operation}</span>
                    </div>
                </div>
            `;
        }).join('');

        this.historyList.innerHTML = html;
    }

    // Helper to set nested value in object
    setNestedValue(obj, path, value) {
        const parts = path.split('.');
        let current = obj;

        for (let i = 0; i < parts.length - 1; i++) {
            if (current[parts[i]] === undefined) {
                current[parts[i]] = {};
            }
            current = current[parts[i]];
        }

        current[parts[parts.length - 1]] = value;
    }
}

// Theme management
function initTheme() {
    const savedTheme = localStorage.getItem('inspector-theme') || 'standard';
    setTheme(savedTheme);

    const selector = document.getElementById('theme-select');
    if (selector) {
        selector.value = savedTheme;
        selector.addEventListener('change', (e) => {
            setTheme(e.target.value);
        });
    }
}

function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('inspector-theme', theme);
}

// Panel resize functionality
function initResize() {
    const handle = document.getElementById('resize-handle');
    const inspector = document.getElementById('inspector-panel');
    if (!handle || !inspector) return;

    // Load saved width
    const savedWidth = localStorage.getItem('inspector-width');
    if (savedWidth) {
        inspector.style.width = savedWidth + 'px';
    }

    let isDragging = false;
    let startX, startWidth;

    handle.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.clientX;
        startWidth = inspector.offsetWidth;
        handle.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;

        // Calculate new width (dragging left increases inspector width)
        const delta = startX - e.clientX;
        const newWidth = Math.max(400, Math.min(startWidth + delta, window.innerWidth * 0.6));
        inspector.style.width = newWidth + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (!isDragging) return;
        isDragging = false;
        handle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';

        // Save width
        localStorage.setItem('inspector-width', inspector.offsetWidth);
    });
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initResize();
    window.inspector = new EntityInspector();
});

/**
 * Entity Inspector - WebSocket Client
 * ASCII/Terminal aesthetic debugging tool for Hytale
 */

// GUI Version - must match server mod version for compatibility
const GUI_VERSION = '0.1.1';
const GITHUB_REPO = 'lait-kelomins/laits-entity-inspector';

// Storage key prefix for localStorage
const STORAGE_PREFIX = 'inspector-';

// Settings to persist with their defaults
const PERSISTED_SETTINGS = {
    'active-tab': 'entities',
    'filter': '',
    'component-filter': '',
    'asset-filter': '',
    'alarms-filter': '',
    'alarms-sort': 'name',
    'packet-log-paused': true,
    'packet-log-filter': '',
    'packet-direction-filter': 'all',
    'packet-log-collapsed': false,
    'entity-list-paused': true,
    'inspector-paused': true,
    'live-changes-paused': true
};

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

        // Load persisted UI settings
        this.filter = this.loadSetting('filter');
        this.componentFilter = this.loadSetting('component-filter');

        // Tab state
        this.activeTab = this.loadSetting('active-tab');

        // Asset browser state
        this.hytalorEnabled = false;
        this.assetCategories = [];
        this.selectedCategory = null;
        this.selectedAsset = null;
        this.assetDetail = null;
        this.assetFilter = this.loadSetting('asset-filter');
        this.sessionHistory = [];
        this.searchResults = {}; // categoryId -> matching assets

        // Sensor cache for Role assets (rolePath → { Sensors: {...} })
        this.sensorCache = new Map();
        this.pendingRoleFetches = new Set();

        // Alarms panel state
        this.alarmsFilter = this.loadSetting('alarms-filter');
        this.alarmsSort = this.loadSetting('alarms-sort');

        // Game time tracking (for alarm remaining time calculations)
        this.gameTimeEpochMilli = null;  // Current game time from server
        this.gameTimeReceivedAt = null;   // Wall-clock time when we received game time
        this.gameTimeRate = null;         // Game seconds per real second (e.g., 72 = 72x speed)
        this.alarmsUpdateInterval = null; // Timer for live alarm updates

        // Alarm debug tracking - stores previous epochMilli values to detect changes
        // Map<entityId, Map<alarmName, { epochMilli, lastChanged }>>
        this.alarmHistory = new Map();

        // Version tracking
        this.serverVersion = null;          // Version received from mod
        this.latestRelease = null;          // Latest release from GitHub
        this.updateCheckDone = false;       // Whether we've checked for updates

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
        this.packetLogPaused = this.loadSetting('packet-log-paused');
        this.packetLogFilter = this.loadSetting('packet-log-filter');
        this.packetDirectionFilter = this.loadSetting('packet-direction-filter');
        this.selectedPacket = null;
        this.maxPacketLogSize = 1000;
        this.packetLogCollapsed = this.loadSetting('packet-log-collapsed');
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

        // Live changes panel elements
        this.liveChangesPanel = document.getElementById('live-changes-panel');
        this.liveChangesContent = document.getElementById('live-changes-content');
        this.liveChangesPauseBtn = document.getElementById('live-changes-pause-btn');
        this.liveChangesPauseIcon = document.getElementById('live-changes-pause-icon');
        this.liveChangesPauseLabel = document.getElementById('live-changes-pause-label');
        this.liveChangesClearBtn = document.getElementById('live-changes-clear-btn');
        this.liveChangesPaused = this.loadSetting('live-changes-paused');

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

        // Global pause button (footer)
        this.globalPauseBtn = document.getElementById('global-pause-btn');
        this.globalPauseIcon = document.getElementById('global-pause-icon');
        this.globalPauseLabel = document.getElementById('global-pause-label');

        // Individual panel pause buttons
        this.entityListPauseBtn = document.getElementById('entity-list-pause-btn');
        this.entityListPauseIcon = document.getElementById('entity-list-pause-icon');
        this.inspectorPauseBtnHeader = document.getElementById('inspector-pause-btn-header');
        this.inspectorPauseIconHeader = document.getElementById('inspector-pause-icon-header');

        // Panel pause states
        this.entityListPaused = this.loadSetting('entity-list-paused');
        this.inspectorPaused = this.loadSetting('inspector-paused');

        // Tab elements
        this.tabBtns = document.querySelectorAll('.tab-btn');
        this.tabEntities = document.getElementById('tab-entities');
        this.tabAssets = document.getElementById('tab-assets');
        this.tabAlarms = document.getElementById('tab-alarms');
        this.alarmsPanel = document.getElementById('alarms-panel');
        this.alarmsRefreshBtn = document.getElementById('alarms-refresh-btn');
        this.alarmsFilterInput = document.getElementById('alarms-filter');
        this.alarmsSortBtns = document.querySelectorAll('.sort-btn');
        this.timeDebugPanel = document.getElementById('time-debug-panel');
        this.timeDebugToggle = document.getElementById('time-debug-toggle');

        // Asset browser elements
        this.assetTreeEl = document.getElementById('asset-tree');
        this.assetDetailEl = document.getElementById('asset-detail');
        this.assetFilterInput = document.getElementById('asset-filter');
        this.expandAllBtn = document.getElementById('expand-all-btn');
        this.patchBtn = document.getElementById('patch-btn');
        this.historyList = document.getElementById('history-list');

        // Track expanded categories and loaded assets
        this.expandedCategories = new Set();
        this.categoryAssets = {}; // categoryId -> [assets]
        this.loadingCategories = new Set();

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
        this.initializePauseState();  // Set initial pause UI state
        this.connect();
        this.startUptimeTimer();
        this.startGlobalChangesCleanup();
    }

    // ═══════════════════════════════════════════════════════════════
    // SETTINGS PERSISTENCE
    // ═══════════════════════════════════════════════════════════════

    /**
     * Load a setting from localStorage with fallback to default.
     * @param {string} key - Setting key (without prefix)
     * @returns {*} The stored value or default
     */
    loadSetting(key) {
        const stored = localStorage.getItem(STORAGE_PREFIX + key);
        if (stored === null) return PERSISTED_SETTINGS[key];
        try {
            return JSON.parse(stored);
        } catch {
            return stored;
        }
    }

    /**
     * Save a setting to localStorage.
     * @param {string} key - Setting key (without prefix)
     * @param {*} value - Value to store
     */
    saveSetting(key, value) {
        localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
    }

    /**
     * Clear all session-specific data (caches, selections, server state).
     * Called on disconnect to prevent stale data when reconnecting.
     */
    clearSessionData() {
        // Clear entity data
        this.entities.clear();
        this.selectedEntityId = null;

        // Clear caches
        this.sensorCache.clear();
        this.pendingRoleFetches.clear();
        this.alarmHistory.clear();
        this.globalChanges = [];
        this.packetLog = [];

        // Clear asset browser state
        this.assetCategories = [];
        this.assetDetail = null;
        this.sessionHistory = [];
        this.searchResults = {};
        this.expandedCategories.clear();
        this.selectedCategory = null;
        this.selectedAsset = null;
        this.selectedPacket = null;

        // Clear server state
        this.gameTimeEpochMilli = null;
        this.gameTimeReceivedAt = null;
        this.gameTimeRate = null;
        this.serverVersion = null;
        this.serverConfig = null;
        this.hytalorEnabled = false;

        // Re-render panels to show empty state
        this.renderEntityList();
        this.renderInspector();
        this.renderPacketLog();
        if (this.activeTab === 'assets') {
            this.renderAssetTree();
            this.renderAssetDetail();
        }
        if (this.activeTab === 'alarms') {
            this.renderAlarmsPanel();
        }
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

                // Tell server we're paused by default
                this.send('SET_PAUSED', { paused: this.packetLogPaused });
            };

            this.ws.onclose = () => {
                this.setStatus('disconnected');
                this.log('Disconnected from server', 'disconnect');
                // Stop alarm live updates on disconnect
                if (this.alarmsUpdateInterval) {
                    clearInterval(this.alarmsUpdateInterval);
                    this.alarmsUpdateInterval = null;
                }
                // Clear all session data to prevent stale data on reconnect
                this.clearSessionData();
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
                case 'TIME_SYNC':
                    this.handleTimeSync(msg.data);
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

        // Store game time for alarm calculations
        if (data.gameTimeEpochMilli) {
            this.gameTimeEpochMilli = data.gameTimeEpochMilli;
            this.gameTimeReceivedAt = Date.now();
        }
        if (data.gameTimeRate) {
            this.gameTimeRate = data.gameTimeRate;
        }

        // Store server version and check compatibility
        if (data.serverVersion) {
            this.serverVersion = data.serverVersion;
            this.checkVersionCompatibility();
        }

        // Check for updates (only once per session)
        if (!this.updateCheckDone) {
            this.checkForUpdates();
        }

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

        if (!this.entityListPaused) {
            this.renderEntityList();
            this.updateEntityCount();

            // Flash animation for new entity
            setTimeout(() => {
                const row = document.querySelector(`[data-entity-id="${entity.entityId}"]`);
                if (row) row.classList.add('spawned');
            }, 10);
        }
    }

    handleDespawn(data) {
        const entityId = data.entityId;
        const entity = this.entities.get(entityId);
        const name = entity ? (entity.modelAssetId || entity.entityType || 'Entity') : 'Entity';

        this.log(`DESPAWN: ${name} #${entityId}`, 'despawn');

        if (this.entityListPaused) {
            // Just delete from data, don't update UI
            this.entities.delete(entityId);
            return;
        }

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

        // Update entity list UI (skip if paused)
        if (!this.entityListPaused) {
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
        }

        // Update inspector if selected (skip if paused)
        if (this.selectedEntityId === entity.entityId && !this.inspectorPaused) {
            this.renderInspector();
        }

        // Note: We don't auto-refresh alarms panel on every update anymore
        // as it causes click interaction issues. User can switch tabs to refresh.
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

                // Update display (skip if entity list paused)
                if (!this.entityListPaused) {
                    const row = document.querySelector(`[data-entity-id="${pos.entityId}"]`);
                    if (row) {
                        const posEl = row.querySelector('.col-pos');
                        if (posEl) {
                            posEl.textContent = this.formatPosition(entity.position);
                        }
                    }
                }
            }
        });

        // Update inspector if showing position (skip if paused)
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
                this.saveSetting('packet-log-filter', this.packetLogFilter);
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
                this.saveSetting('packet-direction-filter', this.packetDirectionFilter);
                this.renderPacketLog();
            });

            this.packetDirectionSelect.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }
    }

    togglePacketLogPanel() {
        this.packetLogCollapsed = !this.packetLogCollapsed;
        this.saveSetting('packet-log-collapsed', this.packetLogCollapsed);
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
     * Handle TIME_SYNC message - updates game time reference for alarm calculations.
     * Sent periodically by server to keep client interpolation accurate when game time rate changes.
     */
    handleTimeSync(data) {
        if (data.gameTimeEpochMilli !== undefined && data.gameTimeEpochMilli !== null) {
            this.gameTimeEpochMilli = data.gameTimeEpochMilli;
            this.gameTimeReceivedAt = Date.now();
        }
        if (data.gameTimeRate !== undefined && data.gameTimeRate !== null) {
            this.gameTimeRate = data.gameTimeRate;
        }
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

    initializePauseState() {
        // Set initial UI state for all pause buttons
        this.updateEntityListPauseUI();
        this.updateInspectorPauseUI();
        this.updatePacketLogPauseUI();
        this.updateLiveChangesPauseUI();
        this.updateGlobalPauseUI();
        this.updateExpandableStates();

        // Restore persisted input values
        if (this.searchInput) this.searchInput.value = this.filter;
        if (this.componentFilterInput) this.componentFilterInput.value = this.componentFilter;
        if (this.packetFilterInput) this.packetFilterInput.value = this.packetLogFilter;
        if (this.packetDirectionSelect) this.packetDirectionSelect.value = this.packetDirectionFilter;
        if (this.assetFilterInput) this.assetFilterInput.value = this.assetFilter;
        if (this.alarmsFilterInput) this.alarmsFilterInput.value = this.alarmsFilter;

        // Restore alarms sort button state
        if (this.alarmsSortBtns) {
            this.alarmsSortBtns.forEach(btn => {
                btn.classList.toggle('active', btn.dataset.sort === this.alarmsSort);
            });
        }

        // Restore packet log collapsed state
        if (this.packetLogPanel && this.packetLogCollapsed) {
            this.packetLogPanel.classList.add('collapsed');
        }

        // Restore active tab
        this.switchTab(this.activeTab);
    }

    toggleEntityListPause() {
        this.entityListPaused = !this.entityListPaused;
        this.saveSetting('entity-list-paused', this.entityListPaused);
        this.updateEntityListPauseUI();
        this.updateGlobalPauseUI();

        // Refresh entity list when resumed
        if (!this.entityListPaused) {
            this.renderEntityList();
            this.updateEntityCount();
        }

        this.log(`Entity list ${this.entityListPaused ? 'paused' : 'resumed'}`, 'info');
    }

    toggleInspectorPause() {
        this.inspectorPaused = !this.inspectorPaused;
        this.saveSetting('inspector-paused', this.inspectorPaused);
        this.updateInspectorPauseUI();
        this.updateExpandableStates();
        this.updateGlobalPauseUI();

        // Refresh inspector when resumed
        if (!this.inspectorPaused) {
            this.renderInspector();
        }

        this.log(`Inspector ${this.inspectorPaused ? 'paused' : 'resumed'}`, 'info');
    }

    togglePacketLogPause() {
        this.packetLogPaused = !this.packetLogPaused;
        this.saveSetting('packet-log-paused', this.packetLogPaused);
        this.updatePacketLogPauseUI();
        this.updateGlobalPauseUI();

        // Render to show accumulated packets
        this.renderPacketLog();

        // Sync with server
        this.send('SET_PAUSED', { paused: this.packetLogPaused });

        this.log(`Packet log ${this.packetLogPaused ? 'paused' : 'resumed'}`, 'info');
    }

    toggleGlobalPause() {
        // If any panel is running, pause all. If all are paused, resume all.
        const anyRunning = !this.entityListPaused || !this.inspectorPaused || !this.packetLogPaused || !this.liveChangesPaused;

        this.entityListPaused = anyRunning;
        this.inspectorPaused = anyRunning;
        this.packetLogPaused = anyRunning;
        this.liveChangesPaused = anyRunning;

        // Save all pause states
        this.saveSetting('entity-list-paused', this.entityListPaused);
        this.saveSetting('inspector-paused', this.inspectorPaused);
        this.saveSetting('packet-log-paused', this.packetLogPaused);
        this.saveSetting('live-changes-paused', this.liveChangesPaused);

        this.updateEntityListPauseUI();
        this.updateInspectorPauseUI();
        this.updatePacketLogPauseUI();
        this.updateLiveChangesPauseUI();
        this.updateExpandableStates();
        this.updateGlobalPauseUI();

        // Sync packet log with server
        this.send('SET_PAUSED', { paused: this.packetLogPaused });

        // Refresh panels when resumed
        if (!anyRunning) {
            this.renderEntityList();
            this.updateEntityCount();
            this.renderInspector();
            this.renderPacketLog();
            this.globalChanges = []; // Clear old changes when resuming
            this.renderLiveChanges();
        }

        this.log(`All panels ${anyRunning ? 'paused' : 'resumed'}`, 'info');
    }

    updateEntityListPauseUI() {
        if (this.entityListPauseBtn) {
            this.entityListPauseBtn.classList.toggle('paused', this.entityListPaused);
        }
        if (this.entityListPauseIcon) {
            this.entityListPauseIcon.textContent = this.entityListPaused ? '▶' : '||';
        }
        const label = document.getElementById('entity-list-pause-label');
        if (label) {
            label.textContent = this.entityListPaused ? 'PLAY' : 'PAUSE';
        }
    }

    updateInspectorPauseUI() {
        if (this.inspectorPauseBtnHeader) {
            this.inspectorPauseBtnHeader.classList.toggle('paused', this.inspectorPaused);
        }
        if (this.inspectorPauseIconHeader) {
            this.inspectorPauseIconHeader.textContent = this.inspectorPaused ? '▶' : '||';
        }
        const label = document.getElementById('inspector-pause-label-header');
        if (label) {
            label.textContent = this.inspectorPaused ? 'PLAY' : 'PAUSE';
        }
    }

    updatePacketLogPauseUI() {
        if (this.packetPauseIcon) {
            this.packetPauseIcon.textContent = this.packetLogPaused ? '▶' : '||';
        }
        if (this.packetPauseBtn) {
            this.packetPauseBtn.classList.toggle('active', this.packetLogPaused);
        }
        const label = document.getElementById('packet-pause-label');
        if (label) {
            label.textContent = this.packetLogPaused ? 'PLAY' : 'PAUSE';
        }
    }

    updateGlobalPauseUI() {
        const allPaused = this.entityListPaused && this.inspectorPaused && this.packetLogPaused && this.liveChangesPaused;
        if (this.globalPauseBtn) {
            this.globalPauseBtn.classList.toggle('active', allPaused);
        }
        if (this.globalPauseIcon) {
            // Show ▶ when paused (click to play), || when running (click to pause)
            this.globalPauseIcon.textContent = allPaused ? '▶' : '||';
        }
        if (this.globalPauseLabel) {
            this.globalPauseLabel.textContent = allPaused ? 'RESUME ALL' : 'PAUSE ALL';
        }
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

        // Render alarms section (if entity has alarms)
        const alarms = this.extractAlarms(entity);
        const timers = this.extractTimers(entity);
        const runningTimer = timers.find(t => t.state === 'RUNNING');
        html += this.renderAlarmsSection(alarms, runningTimer);

        // Render timers section (if entity has active timers)
        html += this.renderTimersSection(timers);

        // Render sensors section (if we have cached role data)
        const rolePath = this.extractRolePath(entity);
        if (rolePath) {
            const roleData = this.sensorCache.get(rolePath);
            if (roleData?.Sensors) {
                html += this.renderSensorsSection(roleData.Sensors);
            } else if (!this.pendingRoleFetches.has(rolePath)) {
                // Trigger async fetch for role data
                this.fetchSensorsForRole(rolePath);
            }
        }

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

        // Add expand handlers for expandable alarms
        this.inspectorEl.querySelectorAll('.expandable-alarm').forEach(el => {
            el.addEventListener('click', () => {
                const path = el.dataset.expandPath;
                if (path && this.selectedEntityId) {
                    // Can only expand if paused or pauseOnExpand is enabled
                    if (!this.inspectorPaused && !this.pauseOnExpand) {
                        this.log('Enable "Auto-pause on Expand" in settings or pause manually', 'info');
                        return;
                    }
                    // Auto-pause when expanding
                    if (!this.inspectorPaused && this.pauseOnExpand) {
                        this.toggleInspectorPause();
                    }
                    this.requestExpand(this.selectedEntityId, path);
                    el.classList.add('loading');
                    el.querySelector('.alarm-remaining').textContent = 'loading...';
                }
            });
        });

        // Add collapse toggle handlers for JSON tree
        // Alt+Click expands/collapses all descendants recursively
        this.inspectorEl.querySelectorAll('.collapsible').forEach(row => {
            row.addEventListener('click', (e) => {
                e.stopPropagation();
                const children = row.nextElementSibling;
                const toggle = row.querySelector('.collapse-toggle');
                const willCollapse = !row.classList.contains('collapsed');

                if (e.altKey) {
                    // Alt+Click: expand/collapse all descendants
                    this.setCollapseStateRecursive(row, willCollapse);
                } else {
                    // Normal click: toggle just this item
                    row.classList.toggle('collapsed');
                    if (children) children.classList.toggle('collapsed');
                    toggle.textContent = willCollapse ? '▶' : '▼';
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

    /**
     * Recursively set collapse state on an element and all its descendants.
     * Used for Alt+Click expand/collapse all functionality.
     */
    setCollapseStateRecursive(row, collapse) {
        const children = row.nextElementSibling;
        const toggle = row.querySelector('.collapse-toggle');

        // Set state on this element
        row.classList.toggle('collapsed', collapse);
        if (children) children.classList.toggle('collapsed', collapse);
        if (toggle) toggle.textContent = collapse ? '▶' : '▼';

        // Recursively set state on all nested collapsibles
        if (children) {
            children.querySelectorAll('.collapsible').forEach(nestedRow => {
                const nestedChildren = nestedRow.nextElementSibling;
                const nestedToggle = nestedRow.querySelector('.collapse-toggle');

                nestedRow.classList.toggle('collapsed', collapse);
                if (nestedChildren) nestedChildren.classList.toggle('collapsed', collapse);
                if (nestedToggle) nestedToggle.textContent = collapse ? '▶' : '▼';
            });
        }
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

            // Collapsible object: always collapsed by default (component header is the root)
            const collapseClass = 'collapsed';
            const toggleIcon = '▶';
            const summary = `{...${entries.length} keys}`;

            const typeLabel = value._type ? ` <span class="type-hint">${escapeHtml(value._type)}</span>` : '';
            let childrenHtml = '';
            for (const [k, v] of entries) {
                childrenHtml += this.renderProperty(k, v, depth + 1, currentPath);
            }

            let html = `<div class="prop-row collapsible ${collapseClass}" ${indentStyle} data-path="${escapeHtml(currentPath)}">
                <span class="collapse-toggle">${toggleIcon}</span>
                <span class="prop-key">${safeKey}:</span>
                <span class="prop-value">{${typeLabel}</span>
                <span class="collapse-summary">${summary}</span>
            </div>
            <div class="prop-children ${collapseClass}">
                ${childrenHtml}
                <div class="prop-row" ${indentStyle}><span class="prop-value">}</span></div>
            </div>`;
            return html;
        }

        if (Array.isArray(value)) {
            // Check if array contains objects (render each on separate line) or primitives
            if (value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
                // Collapsible array: always collapsed by default (component header is the root)
                const collapseClass = 'collapsed';
                const toggleIcon = '▶';
                const summary = `[...${value.length} items]`;

                let childrenHtml = '';
                value.forEach((item, idx) => {
                    childrenHtml += this.renderProperty(String(idx), item, depth + 1, currentPath);
                });

                let html = `<div class="prop-row collapsible ${collapseClass}" ${indentStyle} data-path="${escapeHtml(currentPath)}">
                    <span class="collapse-toggle">${toggleIcon}</span>
                    <span class="prop-key">${safeKey}:</span>
                    <span class="prop-value">[</span>
                    <span class="collapse-summary">${summary}</span>
                </div>
                <div class="prop-children ${collapseClass}">
                    ${childrenHtml}
                    <div class="prop-row" ${indentStyle}><span class="prop-value">]</span></div>
                </div>`;
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
    // ALARMS & SENSORS
    // ═══════════════════════════════════════════════════════════════

    /**
     * Extract alarms from entity snapshot data.
     * Alarms are stored in InteractionManager.fields.entity.alarmStore.parameters
     * or in the data/fields structure depending on how the server serializes it.
     */
    extractAlarms(entity) {
        const alarms = {};
        const entityId = entity.entityId;

        // Try InteractionManager first (most common location)
        const interactionManager = entity.components?.InteractionManager;
        let alarmStore = null;

        if (interactionManager) {
            // Try different paths based on serialization format
            // Path 1: fields.entity.alarmStore.parameters (MCP inspector format)
            alarmStore = interactionManager.fields?.entity?.alarmStore?.parameters;

            // Path 2: data.entity.alarmStore.parameters
            if (!alarmStore) {
                alarmStore = interactionManager.data?.entity?.alarmStore?.parameters;
            }

            // Path 3: entity.alarmStore.parameters (direct)
            if (!alarmStore) {
                alarmStore = interactionManager.entity?.alarmStore?.parameters;
            }

            // Path 4: alarmStore.parameters (if entity is flattened)
            if (!alarmStore) {
                alarmStore = interactionManager.alarmStore?.parameters;
            }
        }

        // Fallback to NPCEntity
        if (!alarmStore) {
            const npcEntity = entity.components?.NPCEntity;
            if (npcEntity) {
                alarmStore = npcEntity.fields?.entity?.alarmStore?.parameters
                    || npcEntity.data?.entity?.alarmStore?.parameters
                    || npcEntity.entity?.alarmStore?.parameters;
            }
        }

        if (!alarmStore) return alarms;

        // Get or create history for this entity
        if (!this.alarmHistory.has(entityId)) {
            this.alarmHistory.set(entityId, new Map());
        }
        const entityHistory = this.alarmHistory.get(entityId);

        for (const [name, data] of Object.entries(alarmStore)) {
            if (data._expandable) {
                // Alarm exists but not expanded - assume SET since it's defined
                alarms[name] = { state: 'SET', expandable: true };
            } else {
                // Expanded alarm data
                let state = 'UNSET';
                let remainingMs = null;

                // Check isSet field first (most reliable)
                const isSet = data.isSet ?? data.set;
                const hasPassed = data.hasPassed ?? data.passed ?? false;

                // Try multiple paths for the alarm instant/trigger time
                const epochMilli = data.alarmInstant?.epochMilli
                    || data.instant?.epochMilli
                    || data.triggerTime?.epochMilli
                    || data.epochMilli;

                // Track epochMilli changes for debugging
                let epochChanged = false;
                let previousEpoch = null;
                let changeCount = 0;
                const prevHistory = entityHistory.get(name);
                if (prevHistory) {
                    previousEpoch = prevHistory.epochMilli;
                    changeCount = prevHistory.changeCount || 0;
                    if (epochMilli !== undefined && epochMilli !== null &&
                        previousEpoch !== undefined && previousEpoch !== null &&
                        epochMilli !== previousEpoch) {
                        epochChanged = true;
                        changeCount++;
                    }
                }
                // Update history
                entityHistory.set(name, {
                    epochMilli,
                    lastSeen: Date.now(),
                    changeCount
                });

                // Game time uses Instant starting from year 0001, which gives negative epoch values
                // Check if we have an epoch value and current game time to calculate remaining
                const currentGameTime = this.getCurrentGameTime();
                const hasValidTime = epochMilli !== undefined && epochMilli !== null && currentGameTime !== null;

                if (isSet === false) {
                    // Explicitly not set
                    state = 'UNSET';
                } else if (hasPassed) {
                    // Explicitly passed
                    state = 'PASSED';
                } else if (hasValidTime) {
                    // Calculate remaining using game time, not wall-clock time
                    remainingMs = epochMilli - currentGameTime;
                    state = remainingMs > 0 ? 'SET' : 'PASSED';
                } else if (isSet === true) {
                    // isSet but no valid time - alarm is set but not scheduled yet
                    state = 'SET';
                } else {
                    // Unknown state
                    state = 'UNSET';
                }

                alarms[name] = {
                    state,
                    remainingMs,
                    epochMilli,
                    expanded: true,
                    // Debug info
                    epochChanged,
                    previousEpoch,
                    changeCount
                };
            }
        }
        return alarms;
    }

    /**
     * Extract timers from entity's Timers component.
     * Timers have: value (current), maxValue, rate, state, repeating
     */
    extractTimers(entity) {
        const timers = [];
        const timersComponent = entity.components?.Timers;

        if (!timersComponent) return timers;

        const timerArray = timersComponent.fields?.timers
            || timersComponent.data?.timers
            || timersComponent.timers;

        if (!Array.isArray(timerArray)) return timers;

        for (let i = 0; i < timerArray.length; i++) {
            const t = timerArray[i];
            if (!t || t._expandable) continue;

            const state = t.state || 'STOPPED';
            const value = t.value ?? 0;
            const maxValue = t.maxValue ?? 0;
            const rate = t.rate ?? 1;
            const repeating = t.repeating ?? false;

            // Calculate remaining time (timers count UP to maxValue)
            let remainingSeconds = null;
            if (state === 'RUNNING' && rate > 0 && maxValue > value) {
                remainingSeconds = (maxValue - value) / rate;
            }

            // Only show timers that are running or have meaningful values
            if (state === 'RUNNING' || state === 'PAUSED' || (maxValue > 0 && value > 0)) {
                timers.push({
                    index: i,
                    state,
                    value,
                    maxValue,
                    rate,
                    repeating,
                    remainingSeconds
                });
            }
        }

        return timers;
    }

    /**
     * Extract the Role path from an entity for sensor lookup.
     */
    extractRolePath(entity) {
        // Try InteractionManager first
        const interactionManager = entity.components?.InteractionManager;
        let roleName = interactionManager?.fields?.entity?.roleName
            || interactionManager?.data?.entity?.roleName;

        // Fallback to NPCEntity
        if (!roleName) {
            const npcEntity = entity.components?.NPCEntity;
            roleName = npcEntity?.fields?.roleName
                || npcEntity?.data?.roleName
                || npcEntity?.roleName;
        }

        if (!roleName) return null;

        // Construct the role path - roles are in NPC/Roles/{RoleName}
        return `NPC/Roles/${roleName}`;
    }

    /**
     * Fetch sensors for a role by requesting the Role asset.
     */
    fetchSensorsForRole(rolePath) {
        if (!rolePath || this.sensorCache.has(rolePath) || this.pendingRoleFetches.has(rolePath)) {
            return;
        }

        // Mark as pending to prevent duplicate requests
        this.pendingRoleFetches.add(rolePath);

        // Role paths like "NPC/Roles/Animals/Sheep" → category "NPC", assetId "Roles/Animals/Sheep"
        const category = 'NPC';
        const assetId = rolePath.replace(/^NPC\//, '');

        this.send('REQUEST_ASSET_DETAIL', { category, assetId });
        this.log(`Fetching sensors for role: ${rolePath}`, 'info');
    }

    /**
     * Get current game time in epoch milliseconds.
     * Estimates based on when we received game time and elapsed real time.
     * Note: Game time may progress at different rates than real time (day/night cycle).
     * Returns null if game time is not available.
     */
    getCurrentGameTime() {
        if (this.gameTimeEpochMilli === null || this.gameTimeReceivedAt === null) {
            return null;
        }
        // Estimate current game time by adding elapsed real time scaled by game time rate
        const elapsedRealMs = Date.now() - this.gameTimeReceivedAt;
        const rate = this.gameTimeRate || 1; // Default to 1:1 if rate unknown
        const elapsedGameMs = elapsedRealMs * rate;
        return this.gameTimeEpochMilli + elapsedGameMs;
    }

    /**
     * Convert game time milliseconds to real time milliseconds.
     * Useful for displaying "real" remaining time for alarms.
     */
    gameTimeToRealTime(gameMs) {
        const rate = this.gameTimeRate || 1;
        return gameMs / rate;
    }

    /**
     * Update the time debug panel with current values.
     */
    updateTimeDebugPanel() {
        if (!this.timeDebugPanel || this.timeDebugPanel.classList.contains('hidden')) {
            return;
        }

        const now = Date.now();
        const elapsedRealMs = this.gameTimeReceivedAt ? now - this.gameTimeReceivedAt : null;
        const rate = this.gameTimeRate || 1;
        const elapsedGameMs = elapsedRealMs !== null ? elapsedRealMs * rate : null;
        const currentGameTime = this.getCurrentGameTime();

        // Convert game time epoch to ISO for readability
        let currentGameTimeISO = '-';
        if (currentGameTime !== null) {
            try {
                // Game time uses year 0001 start, so epoch is negative
                // We can't use Date directly for negative epochs, so just show the number
                // and calculate approximate game date
                const msPerDay = 86400000;
                const daysFromEpoch = currentGameTime / msPerDay;
                const gameDays = Math.floor(daysFromEpoch + 719528); // Days from year 0001
                currentGameTimeISO = `Day ${gameDays} (~${(currentGameTime / msPerDay).toFixed(2)} days from epoch)`;
            } catch (e) {
                currentGameTimeISO = 'parse error';
            }
        }

        document.getElementById('debug-gameTimeEpochMilli').textContent =
            this.gameTimeEpochMilli !== null ? this.gameTimeEpochMilli.toLocaleString() : 'null';
        document.getElementById('debug-gameTimeReceivedAt').textContent =
            this.gameTimeReceivedAt !== null ? new Date(this.gameTimeReceivedAt).toISOString() : 'null';
        document.getElementById('debug-gameTimeRate').textContent =
            this.gameTimeRate !== null ? this.gameTimeRate.toFixed(4) : 'null (defaulting to 1)';
        document.getElementById('debug-elapsedRealMs').textContent =
            elapsedRealMs !== null ? `${elapsedRealMs.toLocaleString()} ms (${(elapsedRealMs/1000).toFixed(1)}s)` : '-';
        document.getElementById('debug-elapsedGameMs').textContent =
            elapsedGameMs !== null ? `${elapsedGameMs.toLocaleString()} ms (${(elapsedGameMs/1000).toFixed(1)}s)` : '-';
        document.getElementById('debug-currentGameTime').textContent =
            currentGameTime !== null ? currentGameTime.toLocaleString() : 'null';
        document.getElementById('debug-currentGameTimeISO').textContent = currentGameTimeISO;
    }

    /**
     * Format milliseconds as human-readable duration.
     */
    formatDuration(ms) {
        if (ms <= 0) return 'expired';

        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) {
            return `${hours}h ${minutes % 60}m`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // VERSION & UPDATE CHECKING
    // ═══════════════════════════════════════════════════════════════

    /**
     * Check if GUI version matches server version.
     */
    checkVersionCompatibility() {
        if (!this.serverVersion) return;

        const guiMajorMinor = GUI_VERSION.split('.').slice(0, 2).join('.');
        const serverMajorMinor = this.serverVersion.split('.').slice(0, 2).join('.');

        if (guiMajorMinor !== serverMajorMinor) {
            this.showVersionMismatch();
        }
        this.updateVersionDisplay();
    }

    /**
     * Check GitHub for newer releases.
     */
    async checkForUpdates() {
        this.updateCheckDone = true;

        try {
            const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
            if (!response.ok) return;

            const release = await response.json();
            this.latestRelease = {
                version: release.tag_name.replace(/^v/, ''),
                url: release.html_url,
                name: release.name,
                publishedAt: release.published_at
            };

            // Compare with current version
            if (this.isNewerVersion(this.latestRelease.version, GUI_VERSION)) {
                this.showUpdateAvailable();
            }

            this.updateVersionDisplay();
        } catch (err) {
            console.log('Could not check for updates:', err.message);
        }
    }

    /**
     * Compare version strings (semver-like).
     * Returns true if v1 > v2.
     */
    isNewerVersion(v1, v2) {
        const parts1 = v1.split('.').map(Number);
        const parts2 = v2.split('.').map(Number);

        for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
            const p1 = parts1[i] || 0;
            const p2 = parts2[i] || 0;
            if (p1 > p2) return true;
            if (p1 < p2) return false;
        }
        return false;
    }

    /**
     * Show version mismatch warning with actionable guidance.
     */
    showVersionMismatch() {
        const banner = document.getElementById('version-banner');
        if (banner) {
            const guiNewer = this.isNewerVersion(GUI_VERSION, this.serverVersion);
            const releasesUrl = `https://github.com/${GITHUB_REPO}/releases`;

            let hint;
            if (guiNewer) {
                // GUI is newer - user needs to update the mod
                hint = `Update mod to v${GUI_VERSION}: download from <a href="${releasesUrl}" target="_blank">releases</a> and replace the jar in your mods folder`;
            } else {
                // Mod is newer - user needs to update the GUI
                hint = `Update GUI: run <code>update.ps1</code> (Win) or <code>update.sh</code> (Linux/Mac), or <a href="${releasesUrl}" target="_blank">download manually</a>`;
            }

            banner.innerHTML = `
                <span class="version-warning">⚠ Version mismatch: GUI v${GUI_VERSION} / Mod v${this.serverVersion}</span>
                <span class="version-hint">${hint}</span>
            `;
            banner.classList.add('visible', 'mismatch');
        }
    }

    /**
     * Show update available notification.
     */
    showUpdateAvailable() {
        const banner = document.getElementById('version-banner');
        if (banner && !banner.classList.contains('mismatch')) {
            banner.innerHTML = `
                <span class="version-update">🔄 Update available: v${this.latestRelease.version}</span>
                <span class="update-hint">Run <code>update.ps1</code> (Win) or <code>update.sh</code> (Linux/Mac)</span>
                <a href="${this.latestRelease.url}" target="_blank" class="update-link">Manual Download</a>
            `;
            banner.classList.add('visible', 'update');
        }
    }

    /**
     * Update the version display in footer.
     */
    updateVersionDisplay() {
        const versionEl = document.getElementById('version-info');
        if (versionEl) {
            let html = `GUI v${GUI_VERSION}`;
            if (this.serverVersion) {
                html += ` / Mod v${this.serverVersion}`;
            }
            if (this.latestRelease && this.isNewerVersion(this.latestRelease.version, GUI_VERSION)) {
                html += ` <span class="update-hint">(v${this.latestRelease.version} available)</span>`;
            }
            versionEl.innerHTML = html;
        }
    }

    /**
     * Render alarms section for the inspector.
     */
    renderAlarmsSection(alarms, runningTimer = null) {
        if (!alarms || Object.keys(alarms).length === 0) return '';

        let badges = '';
        for (const [name, data] of Object.entries(alarms)) {
            const stateClass = data.state.toLowerCase();
            let timeInfo = '';
            let expandableClass = '';
            let expandPath = '';

            if (data.expandable) {
                timeInfo = '?';
                expandableClass = 'expandable-alarm';
                expandPath = `components.InteractionManager.fields.entity.alarmStore.parameters.${name}`;
            } else if (data.state === 'SET') {
                // SET = alarm is scheduled - show remaining time if available
                // Convert game time to real time for display
                if (data.remainingMs != null && data.remainingMs > 0) {
                    const realRemainingMs = this.gameTimeToRealTime(data.remainingMs);
                    timeInfo = this.formatDuration(realRemainingMs);
                } else {
                    timeInfo = '✓';
                }
            } else if (data.state === 'UNSET') {
                // UNSET = on cooldown - show timer if available
                if (runningTimer && runningTimer.remainingSeconds > 0) {
                    timeInfo = this.formatDuration(runningTimer.remainingSeconds * 1000);
                } else {
                    timeInfo = '⏳';
                }
            } else if (data.state === 'PASSED') {
                // PASSED = timer finished, ready
                timeInfo = '✓';
            }

            badges += `
                <span class="alarm-badge ${stateClass} ${expandableClass}"
                      ${expandPath ? `data-expand-path="${escapeHtml(expandPath)}"` : ''}
                      title="${escapeHtml(name)}: ${data.state === 'SET' ? 'Ready' : data.state === 'UNSET' ? 'Cooldown' : data.state}">
                    ${escapeHtml(name)}${timeInfo ? `<span class="badge-time">${timeInfo}</span>` : ''}
                </span>
            `;
        }

        return `
            <div class="alarm-section component-section">
                <div class="component-header">
                    <span class="toggle">[-]</span>
                    <span class="component-name">⏰ ALARMS</span>
                </div>
                <div class="component-body alarm-badges-container">
                    ${badges}
                </div>
            </div>
        `;
    }

    /**
     * Render timers section for the inspector.
     */
    renderTimersSection(timers) {
        if (!timers || timers.length === 0) return '';

        let html = `
            <div class="timer-section component-section">
                <div class="component-header">
                    <span class="toggle">[-]</span>
                    <span class="component-name">⏱️ TIMERS</span>
                </div>
                <div class="component-body">
        `;

        for (const t of timers) {
            const stateClass = t.state.toLowerCase();
            let progress = '-';
            let remaining = '-';

            if (t.maxValue > 0) {
                progress = `${t.value.toFixed(1)}/${t.maxValue}`;
            }

            if (t.remainingSeconds != null && t.remainingSeconds > 0) {
                remaining = this.formatDuration(t.remainingSeconds * 1000);
            } else if (t.state === 'STOPPED') {
                remaining = 'stopped';
            } else if (t.state === 'PAUSED') {
                remaining = 'paused';
            }

            html += `
                <div class="timer-row ${stateClass}">
                    <span class="timer-index">[${t.index}]</span>
                    <span class="timer-state">${t.state}</span>
                    <span class="timer-progress">${progress}</span>
                    <span class="timer-remaining">${remaining}</span>
                    ${t.repeating ? '<span class="timer-repeat">↻</span>' : ''}
                </div>
            `;
        }

        html += '</div></div>';
        return html;
    }

    /**
     * Render sensors section for the inspector.
     */
    renderSensorsSection(sensors) {
        if (!sensors || Object.keys(sensors).length === 0) return '';

        let html = `
            <div class="sensor-section component-section">
                <div class="component-header">
                    <span class="toggle">[-]</span>
                    <span class="component-name">📡 SENSORS</span>
                </div>
                <div class="component-body">
        `;

        for (const [name, params] of Object.entries(sensors)) {
            const paramStr = params && typeof params === 'object'
                ? Object.keys(params).join(', ')
                : '-';

            html += `
                <div class="sensor-row">
                    <span class="sensor-name">${escapeHtml(name)}</span>
                    <span class="sensor-params">${escapeHtml(paramStr)}</span>
                </div>
            `;
        }

        html += '</div></div>';
        return html;
    }

    /**
     * Collect all alarms across all entities for the global alarms panel.
     */
    collectAllAlarms() {
        let allAlarms = [];

        for (const [entityId, entity] of this.entities) {
            const alarms = this.extractAlarms(entity);
            if (Object.keys(alarms).length === 0) continue;

            const rolePath = this.extractRolePath(entity);
            const sensors = rolePath ? this.sensorCache.get(rolePath)?.Sensors : null;
            const name = entity.modelAssetId || entity.entityType || `Entity #${entityId}`;

            // Extract timers for cooldown display
            const timers = this.extractTimers(entity);
            const runningTimer = timers.find(t => t.state === 'RUNNING');

            // Count SET alarms for sorting
            const setCount = Object.values(alarms).filter(a => a.state === 'SET').length;

            allAlarms.push({
                entityId,
                name,
                alarms,
                sensors: sensors ? Object.keys(sensors) : [],
                setCount,
                runningTimer
            });
        }

        // Apply filter
        if (this.alarmsFilter) {
            allAlarms = allAlarms.filter(entry => {
                const nameMatch = entry.name.toLowerCase().includes(this.alarmsFilter);
                const idMatch = String(entry.entityId).includes(this.alarmsFilter);
                return nameMatch || idMatch;
            });
        }

        // Apply sorting
        switch (this.alarmsSort) {
            case 'name':
                allAlarms.sort((a, b) => a.name.localeCompare(b.name));
                break;
            case 'id':
                allAlarms.sort((a, b) => a.entityId - b.entityId);
                break;
            case 'ready':
                // Sort by SET count (descending), then by soonest alarm
                allAlarms.sort((a, b) => {
                    if (b.setCount !== a.setCount) return b.setCount - a.setCount;
                    const aMin = Math.min(...Object.values(a.alarms).map(x => x.remainingMs ?? Infinity));
                    const bMin = Math.min(...Object.values(b.alarms).map(x => x.remainingMs ?? Infinity));
                    return aMin - bMin;
                });
                break;
        }

        return allAlarms;
    }

    /**
     * Render the global alarms panel.
     */
    renderAlarmsPanel() {
        if (!this.alarmsPanel) return;

        // Update debug panel if visible
        this.updateTimeDebugPanel();

        const allAlarms = this.collectAllAlarms();

        if (allAlarms.length === 0) {
            const message = this.alarmsFilter
                ? `NO MATCHES FOR "${this.alarmsFilter.toUpperCase()}"`
                : 'NO ACTIVE ALARMS IN WORLD';
            this.alarmsPanel.innerHTML = `
                <div class="empty-state">
                    <pre>${message}</pre>
                </div>
            `;
            return;
        }

        // Count total entities with alarms (before filter)
        let totalCount = 0;
        for (const [, entity] of this.entities) {
            if (Object.keys(this.extractAlarms(entity)).length > 0) totalCount++;
        }

        let html = `<div class="alarms-panel-content">`;
        const countText = this.alarmsFilter
            ? `🔔 ${allAlarms.length}/${totalCount} entities`
            : `🔔 ${allAlarms.length} entities`;
        html += `<div class="alarms-header">${countText}</div>`;

        for (const entry of allAlarms) {
            // Build alarm badges
            let alarmBadges = '';
            for (const [name, data] of Object.entries(entry.alarms)) {
                const stateClass = data.state.toLowerCase();
                let timeInfo = '';
                let expandableClass = '';
                let expandPath = '';

                if (data.expandable) {
                    timeInfo = '?';
                    expandableClass = 'expandable-alarm';
                    expandPath = `components.InteractionManager.fields.entity.alarmStore.parameters.${name}`;
                } else if (data.state === 'SET') {
                    // SET = alarm is scheduled - show remaining time if available
                    // Convert game time to real time for display
                    if (data.remainingMs != null && data.remainingMs > 0) {
                        const realRemainingMs = this.gameTimeToRealTime(data.remainingMs);
                        timeInfo = this.formatDuration(realRemainingMs);
                    } else {
                        timeInfo = '✓';
                    }
                } else if (data.state === 'UNSET') {
                    // UNSET = on cooldown - show timer if available
                    if (entry.runningTimer && entry.runningTimer.remainingSeconds > 0) {
                        timeInfo = this.formatDuration(entry.runningTimer.remainingSeconds * 1000);
                    } else {
                        timeInfo = '⏳';
                    }
                } else if (data.state === 'PASSED') {
                    // PASSED = timer finished, ready
                    timeInfo = '✓';
                }

                // Shorten common alarm names
                const shortName = name
                    .replace('_Ready', '')
                    .replace('_Cooldown', '⏳');

                alarmBadges += `
                    <span class="alarm-badge ${stateClass} ${expandableClass}"
                          data-entity-id="${entry.entityId}"
                          ${expandPath ? `data-expand-path="${escapeHtml(expandPath)}"` : ''}
                          title="${escapeHtml(name)}: ${data.state}${timeInfo ? ' - ' + timeInfo : ''}">
                        ${escapeHtml(shortName)}${timeInfo ? `<span class="badge-time">${timeInfo}</span>` : ''}
                    </span>
                `;
            }

            // Build debug info for each alarm if debug panel is visible
            let debugInfo = '';
            const showDebug = this.timeDebugPanel && !this.timeDebugPanel.classList.contains('hidden');
            if (showDebug) {
                for (const [name, data] of Object.entries(entry.alarms)) {
                    const epochMilli = data.epochMilli ?? 'null';
                    const remainingMs = data.remainingMs ?? 'null';
                    const realRemainingMs = data.remainingMs != null ? this.gameTimeToRealTime(data.remainingMs) : null;
                    // Show epoch change tracking
                    const epochChanged = data.epochChanged ? '⚠️ CHANGED!' : '';
                    const prevEpoch = data.previousEpoch != null ? data.previousEpoch : '-';
                    const changeCount = data.changeCount || 0;
                    debugInfo += `
                        <div class="alarm-debug-row ${data.epochChanged ? 'epoch-changed' : ''}">
                            <span class="debug-alarm-name">${escapeHtml(name)}:</span>
                            <span>epoch=${epochMilli} ${epochChanged}</span>
                            <span>prevEpoch=${prevEpoch}</span>
                            <span>changes=${changeCount}</span>
                            <span>gameRemainMs=${remainingMs != null ? Math.round(remainingMs) : 'null'}</span>
                            <span>realRemainMs=${realRemainingMs != null ? Math.round(realRemainingMs) : 'null'}</span>
                            <span>state=${data.state}</span>
                        </div>
                    `;
                }
            }

            html += `
                <div class="alarm-entity-compact" data-entity-id="${entry.entityId}">
                    <span class="entity-info" data-entity-id="${entry.entityId}">
                        <span class="entity-name">${escapeHtml(entry.name)}</span>
                        <span class="entity-id">#${entry.entityId}</span>
                    </span>
                    <span class="alarm-badges">${alarmBadges}</span>
                    ${debugInfo ? `<div class="alarm-debug-info">${debugInfo}</div>` : ''}
                </div>
            `;
        }

        html += `</div>`;
        this.alarmsPanel.innerHTML = html;

        // Add click handlers for expandable alarm badges
        this.alarmsPanel.querySelectorAll('.alarm-badge.expandable-alarm').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const entityId = parseInt(el.dataset.entityId);
                const path = el.dataset.expandPath;
                if (path && entityId) {
                    this.requestExpand(entityId, path);
                    el.classList.add('loading');
                }
            });
        });

        // Add click handlers to entity info to select entity
        this.alarmsPanel.querySelectorAll('.entity-info').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const entityId = parseInt(el.dataset.entityId);
                this.selectEntity(entityId);
                this.switchTab('entities');
            });
        });
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

        // Also re-render alarms panel if that's the active tab
        if (this.activeTab === 'alarms') {
            this.renderAlarmsPanel();
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
        // Skip if paused
        if (this.liveChangesPaused) return;
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

        this.renderLiveChanges();
    }

    /**
     * Render the live changes panel.
     */
    renderLiveChanges() {
        if (!this.liveChangesContent) return;

        if (this.liveChangesPaused) {
            this.liveChangesContent.innerHTML = `
                <div class="empty-state small">
                    <pre>Paused - Click PLAY to start tracking</pre>
                </div>`;
            return;
        }

        const now = Date.now();

        // Filter to recent changes only
        const recent = this.globalChanges.filter(c => now - c.timestamp < this.chipRetentionMs);

        if (recent.length === 0) {
            this.liveChangesContent.innerHTML = `
                <div class="empty-state small">
                    <pre>Waiting for component changes...</pre>
                </div>`;
            return;
        }

        // Deduplicate by entity+component (keep most recent), then take last N
        const seen = new Map();
        recent.forEach(c => seen.set(`${c.entityId}:${c.componentName}`, c));
        const uniqueChanges = Array.from(seen.values())
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, this.maxGlobalChips);

        this.liveChangesContent.innerHTML = uniqueChanges
            .map(c => `
                <div class="live-change-chip" data-entity-id="${c.entityId}" title="Click to select entity">
                    <span class="entity-name">${escapeHtml(c.entityName)}</span>
                    <span class="component-name">${escapeHtml(c.componentName)}</span>
                </div>
            `)
            .join('');

        // Add click handlers to select entity
        this.liveChangesContent.querySelectorAll('.live-change-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const entityId = parseInt(chip.dataset.entityId);
                this.selectEntity(entityId);
            });
        });
    }

    toggleLiveChangesPause() {
        this.liveChangesPaused = !this.liveChangesPaused;
        this.saveSetting('live-changes-paused', this.liveChangesPaused);
        this.updateLiveChangesPauseUI();
        this.updateGlobalPauseUI();

        if (!this.liveChangesPaused) {
            // Clear old changes when resuming
            this.globalChanges = [];
        }
        this.renderLiveChanges();

        this.log(`Live changes ${this.liveChangesPaused ? 'paused' : 'resumed'}`, 'info');
    }

    updateLiveChangesPauseUI() {
        if (this.liveChangesPauseBtn) {
            this.liveChangesPauseBtn.classList.toggle('paused', this.liveChangesPaused);
        }
        if (this.liveChangesPauseIcon) {
            this.liveChangesPauseIcon.textContent = this.liveChangesPaused ? '▶' : '||';
        }
        if (this.liveChangesPauseLabel) {
            this.liveChangesPauseLabel.textContent = this.liveChangesPaused ? 'PLAY' : 'PAUSE';
        }
    }

    clearLiveChanges() {
        this.globalChanges = [];
        this.renderLiveChanges();
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
        // Periodically clean up and refresh the live changes panel
        setInterval(() => {
            const now = Date.now();
            const before = this.globalChanges.length;
            this.globalChanges = this.globalChanges.filter(c => now - c.timestamp < this.chipRetentionMs);

            // Refresh display if changes were removed
            if (this.globalChanges.length !== before || this.globalChanges.length > 0) {
                this.renderLiveChanges();
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
            this.saveSetting('filter', this.filter);
            this.renderEntityList();
        });

        // Component filter
        this.componentFilterInput.addEventListener('input', (e) => {
            this.componentFilter = e.target.value.trim().toLowerCase();
            this.saveSetting('component-filter', this.componentFilter);
            this.renderInspector();
        });

        // Inspector copy button
        if (this.inspectorCopyBtn) {
            this.inspectorCopyBtn.addEventListener('click', () => {
                this.copyInspectorData();
            });
        }

        // Global pause button (footer)
        if (this.globalPauseBtn) {
            this.globalPauseBtn.addEventListener('click', () => {
                this.toggleGlobalPause();
            });
        }

        // Entity list pause button
        if (this.entityListPauseBtn) {
            this.entityListPauseBtn.addEventListener('click', () => {
                this.toggleEntityListPause();
            });
        }

        // Inspector pause button (header)
        if (this.inspectorPauseBtnHeader) {
            this.inspectorPauseBtnHeader.addEventListener('click', () => {
                this.toggleInspectorPause();
            });
        }

        // Live changes pause button
        if (this.liveChangesPauseBtn) {
            this.liveChangesPauseBtn.addEventListener('click', () => {
                this.toggleLiveChangesPause();
            });
        }

        // Live changes clear button
        if (this.liveChangesClearBtn) {
            this.liveChangesClearBtn.addEventListener('click', () => {
                this.clearLiveChanges();
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

                case 's':
                    // Toggle settings
                    this.toggleSettings();
                    break;

                case ' ':
                    // Toggle global pause (all panels)
                    e.preventDefault();
                    this.toggleGlobalPause();
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

                case 'w':
                    // Switch to Alarms/Watch tab
                    this.switchTab('alarms');
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

        // Alarms panel refresh button
        if (this.alarmsRefreshBtn) {
            this.alarmsRefreshBtn.addEventListener('click', () => {
                this.renderAlarmsPanel();
            });
        }

        // Alarms filter input
        if (this.alarmsFilterInput) {
            this.alarmsFilterInput.addEventListener('input', (e) => {
                this.alarmsFilter = e.target.value.trim().toLowerCase();
                this.saveSetting('alarms-filter', this.alarmsFilter);
                this.renderAlarmsPanel();
            });
        }

        // Alarms sort buttons
        if (this.alarmsSortBtns) {
            this.alarmsSortBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    this.alarmsSort = btn.dataset.sort;
                    this.saveSetting('alarms-sort', this.alarmsSort);
                    // Update active state
                    this.alarmsSortBtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.renderAlarmsPanel();
                });
            });
        }

        // Time debug toggle
        if (this.timeDebugToggle) {
            this.timeDebugToggle.addEventListener('click', () => {
                this.timeDebugPanel.classList.toggle('hidden');
                this.timeDebugToggle.classList.toggle('active');
                if (!this.timeDebugPanel.classList.contains('hidden')) {
                    this.updateTimeDebugPanel();
                }
            });
        }
    }

    switchTab(tabName) {
        this.activeTab = tabName;
        this.saveSetting('active-tab', tabName);

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
        if (this.tabAlarms) {
            this.tabAlarms.classList.toggle('active', tabName === 'alarms');
        }

        // Request asset categories when switching to assets tab
        if (tabName === 'assets' && this.assetCategories.length === 0) {
            this.requestAssetCategories();
        }

        // Manage alarm live updates
        if (tabName === 'alarms') {
            this.renderAlarmsPanel();
            // Start live updates every second
            if (!this.alarmsUpdateInterval) {
                this.alarmsUpdateInterval = setInterval(() => {
                    this.renderAlarmsPanel();
                }, 1000);
            }
        } else {
            // Stop live updates when leaving alarms tab
            if (this.alarmsUpdateInterval) {
                clearInterval(this.alarmsUpdateInterval);
                this.alarmsUpdateInterval = null;
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // ASSET BROWSER
    // ═══════════════════════════════════════════════════════════════

    setupAssetBrowserListeners() {
        // Asset filter - search as you type (server-side)
        if (this.assetFilterInput) {
            let searchTimeout = null;
            this.assetFilterInput.addEventListener('input', (e) => {
                this.assetFilter = e.target.value.trim().toLowerCase();
                this.saveSetting('asset-filter', this.assetFilter);

                // Debounce server search
                if (searchTimeout) clearTimeout(searchTimeout);

                if (this.assetFilter.length >= 2) {
                    searchTimeout = setTimeout(() => {
                        this.requestSearchAssets(this.assetFilter);
                    }, 200);
                } else {
                    // Clear search results and show normal tree
                    this.searchResults = {};
                    this.renderAssetTree();
                }
            });
        }

        // Expand/collapse all button
        if (this.expandAllBtn) {
            this.expandAllBtn.addEventListener('click', () => {
                this.toggleExpandAll();
            });
        }

        // Patch button
        if (this.patchBtn) {
            this.patchBtn.addEventListener('click', () => {
                this.openPatchModal();
            });
        }
    }

    toggleExpandAll() {
        const allExpanded = this.expandedCategories.size === this.assetCategories.length;
        if (allExpanded) {
            // Collapse all
            this.expandedCategories.clear();
        } else {
            // Expand all
            for (const cat of this.assetCategories) {
                this.expandedCategories.add(cat.id);
            }
        }
        this.renderAssetTree();
    }

    // Request methods
    requestAssetCategories() {
        this.send('REQUEST_ASSET_CATEGORIES');
    }

    requestAssets(category, filter = null) {
        const data = { category };
        if (filter) {
            data.filter = filter;
        }
        this.send('REQUEST_ASSETS', data);
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
        this.renderAssetTree();
    }

    handleAssetList(data) {
        // Store assets for the category
        const category = data.category;
        if (category) {
            this.categoryAssets[category] = data.assets || [];
            this.loadingCategories.delete(category);
        }
        this.renderAssetTree();
    }

    handleAssetDetail(data) {
        // Cache sensors if this is a Role asset (NPC category with Sensors)
        if (data.category === 'NPC' && data.content?.Sensors) {
            const rolePath = `NPC/${data.id}`;
            this.sensorCache.set(rolePath, data.content);
            this.pendingRoleFetches.delete(rolePath);

            // Re-render inspector if we have a selected entity (may need to show sensors)
            if (this.selectedEntityId) {
                this.renderInspector();
            }
        }

        this.assetDetail = data;
        this.renderAssetDetail();
    }

    handleSearchResults(data) {
        // Search results come with category info - store them appropriately
        const results = data.results || [];
        // Group by category for tree display
        const byCategory = {};
        for (const asset of results) {
            if (!byCategory[asset.category]) {
                byCategory[asset.category] = [];
            }
            byCategory[asset.category].push(asset);
        }
        // Store as search results
        this.searchResults = byCategory;
        this.renderAssetTree();
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
    renderAssetTree() {
        if (!this.assetTreeEl) return;

        if (this.assetCategories.length === 0) {
            this.assetTreeEl.innerHTML = `
                <div class="empty-state small">
                    <pre>No categories found</pre>
                </div>`;
            return;
        }

        const filter = this.assetFilter;
        const hasSearchResults = filter && Object.keys(this.searchResults).length > 0;
        let html = '';

        // Sort categories by display name
        const sortedCategories = [...this.assetCategories].sort((a, b) =>
            a.displayName.localeCompare(b.displayName)
        );

        for (const cat of sortedCategories) {
            const isExpanded = this.expandedCategories.has(cat.id);
            const isLoading = this.loadingCategories.has(cat.id);

            // Use search results when filtering, otherwise use loaded assets
            let displayAssets = [];
            let matchCount = 0;

            if (hasSearchResults) {
                // Use server search results - only show categories with results
                const searchAssets = this.searchResults[cat.id] || [];
                if (searchAssets.length === 0) {
                    continue; // Skip categories with no search results
                }
                displayAssets = [...searchAssets].sort((a, b) => a.id.localeCompare(b.id));
                matchCount = displayAssets.length;
            } else {
                // Normal browsing - use loaded assets
                const assets = this.categoryAssets[cat.id] || [];
                displayAssets = [...assets].sort((a, b) => a.id.localeCompare(b.id));
            }

            // Auto-expand categories with search results
            const showExpanded = hasSearchResults ? true : isExpanded;

            html += `
                <div class="tree-category ${showExpanded ? '' : 'collapsed'}" data-category="${escapeHtml(cat.id)}">
                    <div class="tree-category-header ${hasSearchResults ? 'has-matches' : ''}">
                        <span class="tree-category-toggle">▼</span>
                        <span class="tree-category-name">${escapeHtml(cat.displayName)}</span>
                        ${hasSearchResults
                            ? `<span class="tree-category-match-count">${matchCount}</span>`
                            : `<span class="tree-category-count">${cat.count}</span>`
                        }
                    </div>
                    <div class="tree-assets">
            `;

            if (!hasSearchResults && isLoading) {
                html += `<div class="tree-assets-loading">Loading...</div>`;
            } else if (!hasSearchResults && displayAssets.length === 0 && showExpanded) {
                // Need to load assets
                html += `<div class="tree-assets-loading">Loading...</div>`;
            } else {
                // Show assets
                for (const asset of displayAssets) {
                    const isSelected = this.selectedAsset === asset.id && this.selectedCategory === cat.id;
                    html += `
                        <div class="tree-asset ${isSelected ? 'selected' : ''} ${hasSearchResults ? 'match' : ''}"
                             data-asset-id="${escapeHtml(asset.id)}"
                             data-category="${escapeHtml(cat.id)}">
                            <span class="tree-asset-id">${escapeHtml(asset.id)}</span>
                            <span class="tree-asset-type">${escapeHtml(asset.typeHint || '')}</span>
                        </div>
                    `;
                }
            }

            html += `
                    </div>
                </div>
            `;
        }

        if (!html) {
            html = `<div class="empty-state small"><pre>No matching assets</pre></div>`;
        }

        this.assetTreeEl.innerHTML = html;

        // Add click handlers for category headers
        this.assetTreeEl.querySelectorAll('.tree-category-header').forEach(header => {
            header.addEventListener('click', (e) => {
                const categoryEl = header.parentElement;
                const categoryId = categoryEl.dataset.category;
                this.toggleCategory(categoryId);
            });
        });

        // Add click handlers for assets
        this.assetTreeEl.querySelectorAll('.tree-asset').forEach(item => {
            item.addEventListener('click', () => {
                this.selectAsset(item.dataset.category, item.dataset.assetId);
            });
        });

        // Load assets for expanded categories that don't have data yet (but not during search)
        if (!hasSearchResults) {
            for (const cat of this.assetCategories) {
                const isExpanded = this.expandedCategories.has(cat.id);
                const hasAssets = this.categoryAssets[cat.id] && this.categoryAssets[cat.id].length > 0;
                const isLoading = this.loadingCategories.has(cat.id);

                if (isExpanded && !hasAssets && !isLoading) {
                    this.loadCategoryAssets(cat.id);
                }
            }
        }
    }

    toggleCategory(categoryId) {
        if (this.expandedCategories.has(categoryId)) {
            this.expandedCategories.delete(categoryId);
        } else {
            this.expandedCategories.add(categoryId);
            // Load assets if not already loaded
            if (!this.categoryAssets[categoryId] || this.categoryAssets[categoryId].length === 0) {
                this.loadCategoryAssets(categoryId);
            }
        }
        this.renderAssetTree();
    }

    loadCategoryAssets(categoryId) {
        if (this.loadingCategories.has(categoryId)) return;
        this.loadingCategories.add(categoryId);
        this.requestAssets(categoryId, null);
    }

    selectAsset(category, assetId) {
        this.selectedAsset = assetId;
        this.selectedCategory = category;

        // Update selection UI
        this.assetTreeEl.querySelectorAll('.tree-asset').forEach(item => {
            const matches = item.dataset.assetId === assetId && item.dataset.category === category;
            item.classList.toggle('selected', matches);
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

        // Add collapse toggle handlers for JSON tree
        // Alt+Click expands/collapses all descendants recursively
        this.assetDetailEl.querySelectorAll('.collapsible').forEach(row => {
            row.addEventListener('click', (e) => {
                e.stopPropagation();
                const children = row.nextElementSibling;
                const toggle = row.querySelector('.collapse-toggle');
                const willCollapse = !row.classList.contains('collapsed');

                if (e.altKey) {
                    // Alt+Click: expand/collapse all descendants
                    this.setCollapseStateRecursive(row, willCollapse);
                } else {
                    // Normal click: toggle just this item
                    row.classList.toggle('collapsed');
                    if (children) children.classList.toggle('collapsed');
                    toggle.textContent = willCollapse ? '▶' : '▼';
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

    requestPublishPatch(filename, patchJson) {
        // Direct publish without modal validation (for republishing from history)
        if (!patchJson || patchJson.trim() === '') {
            this.log('Cannot republish: empty patch content', 'error');
            return;
        }
        this.send('REQUEST_PUBLISH_PATCH', { filename, patchJson });
        this.log(`Republishing: ${filename}`, 'info');
    }

    addToHistory(filename, operation, patchContent = null) {
        const entry = {
            id: Date.now() + Math.random(),
            filename,
            baseAssetPath: this.patchBasePath?.value || 'unknown',
            timestamp: Date.now(),
            operation,
            content: patchContent || this.getGeneratedPatch()
        };

        this.sessionHistory.unshift(entry);
        if (this.sessionHistory.length > 50) {
            this.sessionHistory.pop();
        }

        this.renderHistory();
    }

    getGeneratedPatch() {
        // Get the current patch content from the preview
        if (this.patchPreview) {
            return this.patchPreview.textContent;
        }
        return null;
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

        const html = this.sessionHistory.map((entry, index) => {
            const time = new Date(entry.timestamp).toLocaleTimeString();
            return `
                <div class="history-item" data-index="${index}">
                    <div class="filename">${escapeHtml(entry.filename)}</div>
                    <div class="meta">
                        <span class="time">${time}</span>
                        <span class="operation ${entry.operation}">${entry.operation}</span>
                    </div>
                </div>
            `;
        }).join('');

        this.historyList.innerHTML = html;

        // Add click handlers
        this.historyList.querySelectorAll('.history-item').forEach(item => {
            item.addEventListener('click', () => {
                const index = parseInt(item.dataset.index);
                this.showHistoryDetail(index);
            });
        });
    }

    showHistoryDetail(index) {
        const entry = this.sessionHistory[index];
        if (!entry) return;

        // Create modal HTML
        const modalHtml = `
            <div class="history-modal-overlay" id="history-modal-overlay">
                <div class="history-modal">
                    <div class="history-modal-header">
                        <span class="history-modal-title">${escapeHtml(entry.filename)}</span>
                        <button class="history-modal-close" id="history-modal-close">×</button>
                    </div>
                    <div class="history-modal-meta">
                        <span>Asset: ${escapeHtml(entry.baseAssetPath)}</span>
                        <span>Operation: ${entry.operation}</span>
                        <span>Time: ${new Date(entry.timestamp).toLocaleString()}</span>
                    </div>
                    <div class="history-modal-content">
                        <textarea id="history-patch-content" spellcheck="false">${escapeHtml(entry.content || 'No content available')}</textarea>
                    </div>
                    <div class="history-modal-actions">
                        <button class="btn-danger" id="history-delete-btn">Delete</button>
                        <button class="btn-secondary" id="history-copy-btn">Copy</button>
                        <button class="btn-primary" id="history-republish-btn">Republish</button>
                    </div>
                </div>
            </div>
        `;

        // Add modal to DOM
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // Get modal elements
        const overlay = document.getElementById('history-modal-overlay');
        const closeBtn = document.getElementById('history-modal-close');
        const deleteBtn = document.getElementById('history-delete-btn');
        const copyBtn = document.getElementById('history-copy-btn');
        const republishBtn = document.getElementById('history-republish-btn');
        const contentArea = document.getElementById('history-patch-content');

        // Close modal function
        const closeModal = () => overlay.remove();

        // Event handlers
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal();
        });
        closeBtn.addEventListener('click', closeModal);

        deleteBtn.addEventListener('click', () => {
            this.sessionHistory.splice(index, 1);
            this.renderHistory();
            closeModal();
            this.log(`Deleted patch from history: ${entry.filename}`, 'info');
        });

        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(contentArea.value);
            copyBtn.textContent = 'Copied!';
            setTimeout(() => copyBtn.textContent = 'Copy', 1500);
        });

        republishBtn.addEventListener('click', () => {
            const updatedContent = contentArea.value;
            this.requestPublishPatch(entry.filename, updatedContent);
            closeModal();
        });

        // Close on Escape
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
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

// Asset browser resize functionality
function initAssetResize() {
    const handle = document.getElementById('asset-resize-handle');
    const browser = document.querySelector('.asset-browser-panel');
    if (!handle || !browser) return;

    // Load saved width
    const savedWidth = localStorage.getItem('asset-browser-width');
    if (savedWidth) {
        browser.style.width = savedWidth + 'px';
    }

    let isDragging = false;
    let startX, startWidth;

    handle.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.clientX;
        startWidth = browser.offsetWidth;
        handle.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;

        // Calculate new width (dragging right increases browser width)
        const delta = e.clientX - startX;
        const newWidth = Math.max(200, Math.min(startWidth + delta, window.innerWidth * 0.5));
        browser.style.width = newWidth + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (!isDragging) return;
        isDragging = false;
        handle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';

        // Save width
        localStorage.setItem('asset-browser-width', browser.offsetWidth);
    });
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initResize();
    initAssetResize();
    window.inspector = new EntityInspector();
});

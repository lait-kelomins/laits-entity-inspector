/**
 * Entity Inspector - WebSocket Client
 * ASCII/Terminal aesthetic debugging tool for Hytale
 */

// GUI Version - must match server mod version for compatibility
const GUI_VERSION = '0.1.5-alpha';
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
    'live-changes-paused': true,
    'packet-panel-visible': false,
    'live-panel-visible': false,
    'live-filter-entity': '',
    'live-filter-id': '',
    'live-filter-component': '',
    'inspector-subtab': 'components'
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

/**
 * Enhanced JSON editor with indent guides, bracket matching, and auto-indentation.
 */
class JsonEditorEnhancer {
    constructor(textarea, guidesContainer, bracketsContainer, options = {}) {
        this.textarea = textarea;
        this.guidesContainer = guidesContainer;
        this.bracketsContainer = bracketsContainer;
        this.charWidth = 7.2;
        this.lineHeight = 16.8;
        this.paddingLeft = 12;
        this.paddingTop = 8;
        this.indentSize = 2;

        // Toggleable features
        this.showIndentGuides = options.showIndentGuides !== false;
        this.showBracketMatching = options.showBracketMatching !== false;

        // Track last cursor position for bracket matching during scroll
        this.lastCursorPos = 0;

        this.brackets = { '{': '}', '[': ']', '(': ')' };
        this.closingBrackets = new Set(['}', ']', ')']);
        this.allBrackets = new Set(['{', '}', '[', ']', '(', ')']);

        this.init();
    }

    setShowIndentGuides(show) {
        this.showIndentGuides = show;
        this.updateIndentGuides();
    }

    setShowBracketMatching(show) {
        this.showBracketMatching = show;
        this.updateBracketMatching();
    }

    init() {
        // Create scrollable wrappers for overlay sync
        this.guidesScroll = document.createElement('div');
        this.guidesScroll.className = 'indent-guides-scroll';
        this.guidesContainer.appendChild(this.guidesScroll);

        this.bracketsScroll = document.createElement('div');
        this.bracketsScroll.className = 'bracket-highlight-scroll';
        this.bracketsContainer.appendChild(this.bracketsScroll);

        this.textarea.addEventListener('input', () => {
            this.recalibrateOnScroll = true; // Recalibrate on next scroll
            this.updateIndentGuides();
            this.updateBracketMatching();
        });
        // Use requestAnimationFrame for scroll to ensure values are stable
        this.textarea.addEventListener('scroll', () => {
            requestAnimationFrame(() => this.syncScroll());
        });
        this.textarea.addEventListener('click', () => {
            this.lastCursorPos = this.textarea.selectionStart;
            this.updateBracketMatching();
        });
        this.textarea.addEventListener('keyup', () => {
            this.lastCursorPos = this.textarea.selectionStart;
            this.updateBracketMatching();
        });
        this.textarea.addEventListener('keydown', (e) => this.handleKeyDown(e));

        // Measure and initial render after DOM is ready
        requestAnimationFrame(() => {
            this.measureCharWidth();
            this.updateIndentGuides();
        });
    }

    measureCharWidth() {
        // Get computed style from textarea
        const style = getComputedStyle(this.textarea);
        this.paddingTop = parseFloat(style.paddingTop) || 8;
        this.paddingLeft = parseFloat(style.paddingLeft) || 12;

        // Create measurement element matching textarea styling exactly
        const measure = document.createElement('div');
        measure.style.cssText = `
            position: absolute;
            visibility: hidden;
            white-space: pre;
            font-family: ${style.fontFamily};
            font-size: ${style.fontSize};
            line-height: ${style.lineHeight};
            padding: 0;
            margin: 0;
            border: 0;
        `;

        // Measure character width with 100 characters for accuracy
        measure.textContent = 'X'.repeat(100);
        document.body.appendChild(measure);
        this.charWidth = measure.offsetWidth / 100;

        // Measure line height with multiple lines for accuracy
        measure.textContent = 'X\nX\nX\nX\nX\nX\nX\nX\nX\nX'; // 10 lines
        this.lineHeight = measure.offsetHeight / 10;

        document.body.removeChild(measure);

        // Update measurements when textarea content changes significantly
        // to recalibrate based on actual scroll behavior
        this.recalibrateOnScroll = true;
    }

    // Recalibrate line height based on actual textarea scroll behavior
    recalibrateLineHeight() {
        const text = this.textarea.value;
        if (!text) return;

        const lineCount = text.split('\n').length;
        if (lineCount < 10) return; // Not enough lines to measure accurately

        // Calculate line height from scrollHeight
        // scrollHeight = paddingTop + (lineCount * lineHeight) + paddingBottom
        const style = getComputedStyle(this.textarea);
        const paddingBottom = parseFloat(style.paddingBottom) || 8;
        const contentHeight = this.textarea.scrollHeight - this.paddingTop - paddingBottom;

        if (contentHeight > 0 && lineCount > 0) {
            const measuredLineHeight = contentHeight / lineCount;
            // Only update if significantly different to avoid jitter
            if (Math.abs(measuredLineHeight - this.lineHeight) > 0.1) {
                this.lineHeight = measuredLineHeight;
            }
        }
        this.recalibrateOnScroll = false;
    }

    syncScroll() {
        // Recalibrate line height on first scroll for accuracy
        if (this.recalibrateOnScroll) {
            this.recalibrateLineHeight();
            // After recalibration, re-render at content positions
            this.updateIndentGuides();
            this.updateBracketMatching();
        }

        // Direct scroll sync - overlay scrolls exactly like textarea
        const scrollTop = this.textarea.scrollTop;
        const scrollLeft = this.textarea.scrollLeft;

        this.guidesScroll.scrollTop = scrollTop;
        this.guidesScroll.scrollLeft = scrollLeft;
        this.bracketsScroll.scrollTop = scrollTop;
        this.bracketsScroll.scrollLeft = scrollLeft;
    }

    updateIndentGuides() {
        if (!this.showIndentGuides) {
            this.guidesScroll.innerHTML = '';
            return;
        }

        const text = this.textarea.value;
        if (!text) {
            this.guidesScroll.innerHTML = '';
            return;
        }

        const lines = text.split('\n');

        // Use textarea's actual scrollHeight to ensure perfect match
        const totalHeight = this.textarea.scrollHeight;

        // Only render visible range for performance
        const scrollTop = this.textarea.scrollTop;
        const scrollLeft = this.textarea.scrollLeft;
        const viewportHeight = this.textarea.clientHeight;
        const viewportWidth = this.textarea.clientWidth;
        const firstVisible = Math.max(0, Math.floor((scrollTop - this.paddingTop) / this.lineHeight) - 5);
        const lastVisible = Math.min(lines.length - 1, Math.ceil((scrollTop + viewportHeight) / this.lineHeight) + 5);

        let html = '';
        for (let i = firstVisible; i <= lastVisible; i++) {
            const line = lines[i];
            const match = line.match(/^([\t ]+)/);
            if (!match) continue;

            let spaceCount = 0;
            for (const char of match[1]) {
                spaceCount += char === '\t' ? this.indentSize : 1;
            }
            const levels = Math.floor(spaceCount / this.indentSize);

            for (let level = 1; level <= levels; level++) {
                const left = this.paddingLeft + ((level - 1) * this.indentSize * this.charWidth);
                const top = this.paddingTop + (i * this.lineHeight);

                // Skip if outside horizontal viewport
                const viewportLeft = left - scrollLeft;
                if (viewportLeft < -50 || viewportLeft > viewportWidth + 50) continue;

                html += `<div class="indent-guide" style="left:${left}px;top:${top}px;height:${this.lineHeight}px"></div>`;
            }
        }

        // Wrapper div with full content height for proper scrolling
        this.guidesScroll.innerHTML = `<div style="position:relative;height:${totalHeight}px;width:100%">${html}</div>`;

        // Sync scroll position
        this.guidesScroll.scrollTop = scrollTop;
        this.guidesScroll.scrollLeft = scrollLeft;
    }

    updateBracketMatching() {
        this.bracketsScroll.innerHTML = '';

        if (!this.showBracketMatching) return;

        const text = this.textarea.value;
        if (!text) return;

        // Use current cursor position, or last known position if textarea lost focus
        let pos = this.textarea.selectionStart;
        if (pos !== undefined && pos !== null && document.activeElement === this.textarea) {
            this.lastCursorPos = pos;
        } else {
            pos = this.lastCursorPos;
        }
        if (pos === undefined || pos === null) return;

        // Check char at and before cursor
        let bracketPos = -1, bracket = null;
        const charAt = text[pos];
        const charBefore = pos > 0 ? text[pos - 1] : null;

        if (charAt && this.allBrackets.has(charAt)) {
            bracketPos = pos;
            bracket = charAt;
        } else if (charBefore && this.allBrackets.has(charBefore)) {
            bracketPos = pos - 1;
            bracket = charBefore;
        }
        if (bracket === null) return;

        // Create content wrapper with textarea's actual scrollHeight for perfect sync
        const totalHeight = this.textarea.scrollHeight;
        const wrapper = document.createElement('div');
        wrapper.className = 'bracket-content';
        wrapper.style.cssText = `position:relative;height:${totalHeight}px;width:100%`;
        this.bracketsScroll.appendChild(wrapper);

        const matchPos = this.findMatchingBracket(text, bracketPos, bracket);
        this.highlightBracket(text, bracketPos, matchPos === -1 ? 'error' : 'opening', wrapper);
        if (matchPos !== -1) {
            this.highlightBracket(text, matchPos, 'closing', wrapper);
        }

        // Sync scroll at end
        this.bracketsScroll.scrollTop = this.textarea.scrollTop;
        this.bracketsScroll.scrollLeft = this.textarea.scrollLeft;
    }

    findMatchingBracket(text, pos, bracket) {
        const isOpening = this.brackets[bracket] !== undefined;
        const targetBracket = isOpening ? this.brackets[bracket] :
            Object.keys(this.brackets).find(k => this.brackets[k] === bracket);

        if (!targetBracket) return -1;

        let depth = 1;
        const direction = isOpening ? 1 : -1;
        let i = pos + direction;

        while (i >= 0 && i < text.length) {
            const char = text[i];

            // Skip characters inside strings
            if (!this.isInsideString(text, i)) {
                if (char === bracket) {
                    depth++;
                } else if (char === (isOpening ? this.brackets[bracket] : targetBracket)) {
                    depth--;
                    if (depth === 0) return i;
                }
            }

            i += direction;
        }

        return -1;
    }

    isInsideString(text, pos) {
        // Simple check - count unescaped quotes before position
        let inString = false;
        let i = 0;
        while (i < pos) {
            if (text[i] === '"' && (i === 0 || text[i-1] !== '\\')) {
                inString = !inString;
            }
            i++;
        }
        return inString;
    }

    highlightBracket(text, pos, className, container) {
        const beforeText = text.substring(0, pos);
        const lines = beforeText.split('\n');
        const lineNum = lines.length - 1;
        const colNum = lines[lines.length - 1].length;

        // Content coordinates (no scroll adjustment - scroll sync handles it)
        const top = this.paddingTop + (lineNum * this.lineHeight);
        const left = this.paddingLeft + (colNum * this.charWidth);

        const highlight = document.createElement('div');
        highlight.className = `bracket-highlight ${className}`;
        highlight.style.cssText = `top:${top}px;left:${left}px;width:${this.charWidth + 2}px;height:${this.lineHeight}px`;
        container.appendChild(highlight);
    }

    handleKeyDown(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            this.handleEnter();
        } else if (e.key === 'Tab') {
            e.preventDefault();
            this.handleTab(e.shiftKey);
        } else if (e.key === '}' || e.key === ']' || e.key === ')') {
            // Check if we should dedent
            this.handleClosingBracket(e);
        }
    }

    handleEnter() {
        const start = this.textarea.selectionStart;
        const end = this.textarea.selectionEnd;
        const text = this.textarea.value;

        // Get current line's indentation
        const beforeCursor = text.substring(0, start);
        const lines = beforeCursor.split('\n');
        const currentLine = lines[lines.length - 1];
        const indentMatch = currentLine.match(/^(\s*)/);
        let indent = indentMatch ? indentMatch[1] : '';

        // Check if previous character is an opening bracket
        const charBefore = text[start - 1];
        const charAfter = text[start];
        const isOpeningBracket = charBefore && this.brackets[charBefore];
        const isClosingBracket = charAfter && this.closingBrackets.has(charAfter);

        let insertion = '\n' + indent;

        if (isOpeningBracket) {
            // Add extra indentation after opening bracket
            insertion = '\n' + indent + '  ';

            if (isClosingBracket) {
                // Cursor is between { and }, add both lines
                insertion = '\n' + indent + '  \n' + indent;
                // Position cursor on the middle line
                const newPos = start + indent.length + 3;
                this.insertText(insertion, start, end);
                this.textarea.selectionStart = this.textarea.selectionEnd = newPos;
                this.updateIndentGuides();
                return;
            }
        }

        this.insertText(insertion, start, end);
        this.updateIndentGuides();
    }

    handleTab(isShiftKey) {
        const start = this.textarea.selectionStart;
        const end = this.textarea.selectionEnd;
        const text = this.textarea.value;

        if (start === end) {
            // No selection - insert spaces
            if (!isShiftKey) {
                this.insertText('  ', start, end);
            }
        } else {
            // Selection - indent/dedent lines
            const beforeStart = text.substring(0, start);
            const selection = text.substring(start, end);
            const afterEnd = text.substring(end);

            const lineStartIndex = beforeStart.lastIndexOf('\n') + 1;
            const prefix = text.substring(lineStartIndex, start);
            const fullSelection = prefix + selection;

            const lines = fullSelection.split('\n');
            const modifiedLines = lines.map(line => {
                if (isShiftKey) {
                    // Dedent
                    return line.replace(/^  /, '');
                } else {
                    // Indent
                    return '  ' + line;
                }
            });

            const newSelection = modifiedLines.join('\n');
            const newText = text.substring(0, lineStartIndex) + newSelection + afterEnd;

            this.textarea.value = newText;
            this.textarea.selectionStart = lineStartIndex;
            this.textarea.selectionEnd = lineStartIndex + newSelection.length - prefix.length + (isShiftKey ? -2 : 2);
        }

        this.updateIndentGuides();
        this.textarea.dispatchEvent(new Event('input'));
    }

    handleClosingBracket(e) {
        const start = this.textarea.selectionStart;
        const text = this.textarea.value;

        // Get current line before cursor
        const beforeCursor = text.substring(0, start);
        const lines = beforeCursor.split('\n');
        const currentLine = lines[lines.length - 1];

        // If current line is only whitespace, dedent before inserting bracket
        if (/^\s*$/.test(currentLine) && currentLine.length >= 2) {
            e.preventDefault();
            const lineStart = beforeCursor.lastIndexOf('\n') + 1;
            const dedentedLine = currentLine.substring(2);
            const newText = text.substring(0, lineStart) + dedentedLine + e.key + text.substring(start);
            this.textarea.value = newText;
            this.textarea.selectionStart = this.textarea.selectionEnd = lineStart + dedentedLine.length + 1;
            this.updateIndentGuides();
            this.textarea.dispatchEvent(new Event('input'));
        }
    }

    insertText(text, start, end) {
        const currentText = this.textarea.value;
        this.textarea.value = currentText.substring(0, start) + text + currentText.substring(end);
        this.textarea.selectionStart = this.textarea.selectionEnd = start + text.length;
        this.textarea.dispatchEvent(new Event('input'));
    }
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

        // Inspector fullscreen state
        this.inspectorFullscreen = false;

        // Inspector UI state preservation across re-renders
        this.inspectorCollapsedSections = new Set();  // section keys user has collapsed
        this.inspectorExpandedNodes = new Set();      // instruction node paths user has expanded
        this.inspectorExpandedJsonPaths = new Set();   // JSON tree paths user has expanded
        this.inspectorSubTabScroll = { components: 0, instructions: 0 };  // per-subtab scroll positions
        this.eventLogScroll = 0;             // event log timeline scroll position
        this.eventLogScrollAtBottom = true;  // whether user was scrolled to bottom (for sticky-bottom)
        this.eventLogMaxHeight = parseInt(localStorage.getItem(STORAGE_PREFIX + 'event-log-height')) || 240;
        this._lastInspectorHtml = '';                  // change detection cache

        // Instruction node surnames: keyed as "roleName:nodePath" → surname string
        this.instructionNodeSurnames = this.loadNodeSurnames();

        // Load persisted UI settings
        this.filter = this.loadSetting('filter');
        this.componentFilter = this.loadSetting('component-filter');

        // Tab state
        this.activeTab = this.loadSetting('active-tab');
        this.inspectorSubTab = this.loadSetting('inspector-subtab');

        // Asset browser state
        this.hytalorEnabled = false;
        this.assetCategories = [];
        this.selectedCategory = null;
        this.selectedAsset = null;
        this.assetDetail = null;
        this.assetFilter = this.loadSetting('asset-filter');
        this.sessionHistory = [];
        this.searchResults = {}; // categoryId -> matching assets

        // Asset favorites (stored in localStorage)
        this.favorites = this.loadFavorites();

        // Sensor cache for Role assets (rolePath → { Sensors: {...} })
        this.sensorCache = new Map();
        this.pendingRoleFetches = new Set();

        // Instruction cache (entityId → InstructionTreeData)
        this.instructionCache = new Map();
        this.pendingInstructionFetches = new Set();

        // Instruction event history (client-side diffing)
        this.instructionHistory = new Map();          // entityId → Event[]
        this.previousInstructionSnapshot = new Map(); // entityId → InstructionTreeData
        this.maxInstructionEvents = 50;

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

        // Live changes filter elements
        this.liveFilterEntity = document.getElementById('live-filter-entity');
        this.liveFilterId = document.getElementById('live-filter-id');
        this.liveFilterComponent = document.getElementById('live-filter-component');
        this.liveFilterEntityValue = this.loadSetting('live-filter-entity');
        this.liveFilterIdValue = this.loadSetting('live-filter-id');
        this.liveFilterComponentValue = this.loadSetting('live-filter-component');

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
        this.inspectorFullscreenBtn = document.getElementById('inspector-fullscreen-btn');
        this.inspectorFontScaleInput = document.getElementById('inspector-font-scale');
        this.inspectorFontScaleValue = document.getElementById('inspector-font-scale-value');
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

        // Panel visibility toggle buttons (footer)
        this.togglePacketsBtn = document.getElementById('toggle-packets-btn');
        this.toggleLiveBtn = document.getElementById('toggle-live-btn');
        this.packetPanelVisible = this.loadSetting('packet-panel-visible');
        this.livePanelVisible = this.loadSetting('live-panel-visible');

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
        this.refreshAssetsBtn = document.getElementById('refresh-assets-btn');
        this.refreshAssetBtn = document.getElementById('refresh-asset-btn');
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
        this.refreshOriginalBtn = document.getElementById('refresh-original-btn');
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
        this.setupInfoPopovers();
        this.loadHeaderState();
        this.loadCachedConfig();  // Load settings from localStorage as fallback
        this.initializePauseState();  // Set initial pause UI state
        this.connect();
        this.startUptimeTimer();
        this.startGlobalChangesCleanup();
        this.startInstructionPoll();

        // Persistent document-level handlers for event log resize drag
        this._eventLogDrag = null;
        document.addEventListener('mousemove', (e) => {
            if (!this._eventLogDrag) return;
            const { startY, startHeight, target } = this._eventLogDrag;
            const delta = startY - e.clientY;
            const newHeight = Math.max(60, startHeight + delta);
            target.style.height = newHeight + 'px';
        });
        document.addEventListener('mouseup', () => {
            if (!this._eventLogDrag) return;
            const { target, handle } = this._eventLogDrag;
            handle.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            this.eventLogMaxHeight = parseInt(target.style.height);
            localStorage.setItem(STORAGE_PREFIX + 'event-log-height', this.eventLogMaxHeight);
            this._lastInspectorHtml = '';
            this._eventLogDrag = null;
        });
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

    // ── Instruction Node Surnames ──────────────────────────────────

    loadNodeSurnames() {
        try {
            const raw = localStorage.getItem(STORAGE_PREFIX + 'node-surnames');
            if (raw) return new Map(Object.entries(JSON.parse(raw)));
        } catch { /* ignore */ }
        return new Map();
    }

    saveNodeSurnames() {
        const obj = Object.fromEntries(this.instructionNodeSurnames);
        localStorage.setItem(STORAGE_PREFIX + 'node-surnames', JSON.stringify(obj));
    }

    /**
     * Get the surname for a node, keyed by "roleName:nodePath".
     * @returns {string|undefined}
     */
    getNodeSurname(roleName, nodePath) {
        return this.instructionNodeSurnames.get(`${roleName}:${nodePath}`);
    }

    /**
     * Set or clear a surname for a node.
     */
    setNodeSurname(roleName, nodePath, surname) {
        const key = `${roleName}:${nodePath}`;
        if (surname) {
            this.instructionNodeSurnames.set(key, surname);
        } else {
            this.instructionNodeSurnames.delete(key);
        }
        this.saveNodeSurnames();
    }

    /**
     * Resolve a diff context path like "Root[4][1][2]" to a surname if one exists.
     * Falls back to the original context string.
     */
    resolveContextSurname(roleName, context) {
        if (!roleName || !context) return context;

        // Parse "Root[4][1]" → prefix "root", indices [4, 1] → nodePath "root.4.1"
        const match = context.match(/^(Root|Interaction|Death)(.*)$/);
        if (!match) return context;

        const prefix = match[1].toLowerCase();
        const rest = match[2];
        const indices = [];
        const re = /\[(\d+)\]/g;
        let m;
        while ((m = re.exec(rest)) !== null) {
            indices.push(m[1]);
        }

        if (indices.length === 0) return context;

        // Build nodePath and check for surname at each depth (deepest wins)
        let resolved = context;
        let path = prefix;
        for (let i = 0; i < indices.length; i++) {
            path += '.' + indices[i];
            const surname = this.getNodeSurname(roleName, path);
            if (surname) {
                // Rebuild: surname + remaining indices
                const remaining = indices.slice(i + 1).map(idx => `[${idx}]`).join('');
                resolved = `${surname}${remaining}`;
            }
        }

        return resolved;
    }

    /**
     * Resolve all context references in an event label string.
     * Context paths look like: Root[4] "name"[1][2] or Interaction[0][3]
     * Replaces the deepest node path that has a surname.
     */
    resolveEventLabel(label, roleName) {
        // Match full context paths including optional quoted names between brackets
        // e.g. Root[0] "name"[1][2], Interaction[3], Death[0]
        return label.replace(/(Root|Interaction|Death)((?:\[\d+\](?:\s*"[^"]*")?)+)/g, (match, prefix, rest) => {
            return this.resolveContextSurname(roleName, match);
        });
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
        this.instructionCache.clear();
        this.pendingInstructionFetches.clear();
        this.instructionHistory.clear();
        this.previousInstructionSnapshot.clear();
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

                // Request asset categories if we're on the assets tab
                // (switchTab may have been called before connection was ready)
                if (this.activeTab === 'assets' && this.assetCategories.length === 0) {
                    this.requestAssetCategories();
                }

                // Load existing patches into history
                this.requestListPatches();
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
                case 'ASSETS_REFRESHED':
                    this.handleAssetsRefreshed(msg.data);
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
                case 'PATCH_DELETED':
                    this.handlePatchDeleted(msg.data);
                    break;
                case 'PATCHES_LIST':
                    this.handlePatchesList(msg.data);
                    break;
                case 'ALL_PATCHES_LIST':
                    this.handleAllPatchesList(msg.data);
                    break;

                // NPC instruction inspection
                case 'ENTITY_INSTRUCTIONS':
                    this.handleEntityInstructions(msg.data);
                    break;

                // Entity actions
                case 'SURNAME_SET':
                    this.handleSurnameSet(msg.data);
                    break;
                case 'TELEPORT_RESULT':
                    this.handleTeleportResult(msg.data);
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

        // Clean up instruction cache and history for despawned entity
        this.instructionCache.delete(entityId);
        this.pendingInstructionFetches.delete(entityId);
        this.instructionHistory.delete(entityId);
        this.previousInstructionSnapshot.delete(entityId);

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

    toggleInspectorFullscreen() {
        this.inspectorFullscreen = !this.inspectorFullscreen;

        if (this.inspectorFullscreen) {
            // Save inline width (set by panel resize) and clear it so CSS 100% applies
            this._savedInspectorWidth = this.inspectorPanel.style.width;
            this.inspectorPanel.style.width = '';
        } else {
            // Restore inline width
            if (this._savedInspectorWidth) {
                this.inspectorPanel.style.width = this._savedInspectorWidth;
            }
        }

        // Toggle fullscreen class on inspector panel (position: fixed covers viewport)
        this.inspectorPanel.classList.toggle('fullscreen', this.inspectorFullscreen);

        // Hide siblings (entity list + resize handle) so they don't render behind
        if (this.entityListPanel) {
            this.entityListPanel.classList.toggle('hidden', this.inspectorFullscreen);
        }
        if (this.resizeHandle) {
            this.resizeHandle.classList.toggle('hidden', this.inspectorFullscreen);
        }

        // Update button
        if (this.inspectorFullscreenBtn) {
            this.inspectorFullscreenBtn.textContent = this.inspectorFullscreen ? '⤡' : '⤢';
            this.inspectorFullscreenBtn.title = this.inspectorFullscreen ? 'Exit Fullscreen' : 'Toggle Fullscreen';
        }
    }

    applyInspectorFontScale(percent) {
        const el = document.querySelector('.inspector-subtab-content[data-subtab="instructions"]');
        if (el) el.style.zoom = percent + '%';
        // Also store for re-application after re-render
        this._inspectorFontScale = percent;
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
        // Default to collapsed on first start (when key doesn't exist)
        const stored = localStorage.getItem('inspector-header-collapsed');
        const collapsed = stored === null ? true : stored === 'true';
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
        if (this.liveFilterEntity) this.liveFilterEntity.value = this.liveFilterEntityValue;
        if (this.liveFilterId) this.liveFilterId.value = this.liveFilterIdValue;
        if (this.liveFilterComponent) this.liveFilterComponent.value = this.liveFilterComponentValue;

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

        // Restore panel visibility state
        this.updatePanelVisibility();

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
            // Extract surname from LaitInspectorComponent only (inspector-specific data)
            const inspector = entity.components?.LaitInspectorComponent;
            const surname = inspector?.fields?.surname || '';
            return `
                <div class="entity-row ${isSelected ? 'selected' : ''}"
                     data-entity-id="${entity.entityId}">
                    <span class="col-id">#${entity.entityId}</span>
                    <span class="col-type">${escapeHtml(entity.entityType) || '---'}</span>
                    <span class="col-model">${escapeHtml(entity.modelAssetId) || '---'}</span>
                    <span class="col-pos">${this.formatPosition(entity.position)}</span>
                    <span class="col-surname">
                        <span class="surname-text" title="${escapeHtml(surname)}">${escapeHtml(surname) || '---'}</span>
                        <button class="action-btn edit-btn" data-entity-id="${entity.entityId}" data-current="${escapeHtml(surname)}" title="Edit surname">✎</button>
                    </span>
                    <span class="col-actions">
                        <button class="action-btn tp-btn" data-entity-id="${entity.entityId}" title="Teleport to entity">TP</button>
                    </span>
                </div>
            `;
        }).join('');

        this.entityListEl.innerHTML = html;

        // Add click handlers for row selection
        this.entityListEl.querySelectorAll('.entity-row').forEach(row => {
            row.addEventListener('click', (e) => {
                // Don't select when clicking action buttons or surname column
                if (e.target.closest('.action-btn') || e.target.closest('.col-surname')) return;
                const id = parseInt(row.dataset.entityId);
                this.selectEntity(id);
            });
        });

        // Add click handlers for teleport buttons
        this.entityListEl.querySelectorAll('.tp-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const entityId = parseInt(btn.dataset.entityId);
                this.requestTeleportTo(entityId);
            });
        });

        // Add click handlers for edit surname buttons
        this.entityListEl.querySelectorAll('.edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const entityId = parseInt(btn.dataset.entityId);
                const currentSurname = btn.dataset.current || '';
                this.openSurnameEditor(entityId, currentSurname);
            });
        });
    }

    openSurnameEditor(entityId, currentSurname) {
        const newSurname = prompt('Enter new surname:', currentSurname);
        if (newSurname !== null) {
            this.requestSetSurname(entityId, newSurname);
        }
    }

    renderInspector() {
        if (!this.selectedEntityId || !this.entities.has(this.selectedEntityId)) {
            this._lastInspectorHtml = '';
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

        // Sub-tab bar
        const isComponents = this.inspectorSubTab === 'components';
        let html = `
            <div class="inspector-subtab-bar">
                <button class="inspector-subtab-btn${isComponents ? ' active' : ''}" data-subtab="components">COMPONENTS</button>
                <button class="inspector-subtab-btn${!isComponents ? ' active' : ''}" data-subtab="instructions">INSTRUCTIONS</button>
            </div>
        `;

        // === COMPONENTS tab content ===
        html += `<div class="inspector-subtab-content${isComponents ? ' active' : ''}" data-subtab="components">`;

        // Entity header (only in Components tab)
        html += `
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

        // Render entity assets section (model, role references)
        const entityAssets = this.extractEntityAssets(entity);
        html += this.renderEntityAssetsSection(entityAssets);

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

        html += '</div>'; // end COMPONENTS tab

        // === INSTRUCTIONS tab content (flex column: scrollable body + pinned event log) ===
        html += `<div class="inspector-subtab-content${!isComponents ? ' active' : ''}" data-subtab="instructions">`;

        // Scrollable instructions body
        html += '<div class="instructions-scroll-body">';

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

        // Render instructions section (NPC role instruction tree with live state)
        if (entity.entityType === 'NPC' || entity.components?.NPCEntity) {
            html += this.renderInstructionsSection(entity.entityId);
        }

        html += '</div>'; // end scrollable body

        // Resize handle + pinned event log (outside scroll, always visible at bottom)
        if (entity.entityType === 'NPC' || entity.components?.NPCEntity) {
            html += '<div class="event-log-resize-handle" title="Drag to resize event log"></div>';
            const cachedTree = this.instructionCache.get(entity.entityId);
            html += this.renderInstructionEventLog(entity.entityId, cachedTree?.roleName || '');
        }

        html += '</div>'; // end INSTRUCTIONS tab

        // Change detection: skip DOM update if HTML hasn't changed
        if (html === this._lastInspectorHtml) return;
        // Don't replace DOM while user is dragging the event log resize handle
        if (this._eventLogDrag) return;
        this._lastInspectorHtml = html;

        // Save current sub-tab scroll ratio before DOM replacement (ratio is zoom-proof)
        const scrollEl = this.getSubTabScrollElement();
        if (scrollEl) {
            const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight;
            this.inspectorSubTabScroll[this.inspectorSubTab] = maxScroll > 0 ? scrollEl.scrollTop / maxScroll : 0;
        }

        // Save event log scroll position (detect if user was at bottom for sticky-bottom)
        const timelineEl = this.inspectorEl.querySelector('.instruction-timeline');
        if (timelineEl) {
            this.eventLogScroll = timelineEl.scrollTop;
            this.eventLogScrollAtBottom = (timelineEl.scrollTop + timelineEl.clientHeight >= timelineEl.scrollHeight - 5);
        }

        this.inspectorEl.innerHTML = html;

        // Add toggle handlers
        this.inspectorEl.querySelectorAll('.component-header').forEach(header => {
            header.addEventListener('click', () => {
                const body = header.nextElementSibling;
                const toggle = header.querySelector('.toggle');
                const section = header.closest('.component-section');
                const sectionKey = section?.dataset.sectionKey || '';
                if (body.classList.contains('collapsed')) {
                    body.classList.remove('collapsed');
                    toggle.textContent = '[-]';
                    this.inspectorCollapsedSections.delete(sectionKey);
                } else {
                    body.classList.add('collapsed');
                    toggle.textContent = '[+]';
                    this.inspectorCollapsedSections.add(sectionKey);
                }
            });
        });

        // Sub-tab click handlers (pure DOM toggle, no re-render)
        this.inspectorEl.querySelectorAll('.inspector-subtab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.subtab;
                if (tab === this.inspectorSubTab) return;
                // Save scroll ratio of the tab we're leaving
                const leavingScrollEl = this.getSubTabScrollElement();
                if (leavingScrollEl) {
                    const maxScroll = leavingScrollEl.scrollHeight - leavingScrollEl.clientHeight;
                    this.inspectorSubTabScroll[this.inspectorSubTab] = maxScroll > 0 ? leavingScrollEl.scrollTop / maxScroll : 0;
                }
                this.inspectorSubTab = tab;
                this.saveSetting('inspector-subtab', tab);
                // Toggle active class on buttons
                this.inspectorEl.querySelectorAll('.inspector-subtab-btn').forEach(b => {
                    b.classList.toggle('active', b.dataset.subtab === tab);
                });
                // Toggle active class on content divs
                this.inspectorEl.querySelectorAll('.inspector-subtab-content').forEach(div => {
                    div.classList.toggle('active', div.dataset.subtab === tab);
                });
                // Toggle filter visibility
                this.inspectorPanel.classList.toggle('subtab-instructions', tab === 'instructions');
                // Restore scroll ratio for the tab we're switching to
                const enteringScrollEl = this.getSubTabScrollElement();
                if (enteringScrollEl) {
                    const maxScroll = enteringScrollEl.scrollHeight - enteringScrollEl.clientHeight;
                    enteringScrollEl.scrollTop = this.inspectorSubTabScroll[tab] * maxScroll;
                }
            });
        });

        // Apply filter visibility based on current sub-tab
        this.inspectorPanel.classList.toggle('subtab-instructions', this.inspectorSubTab === 'instructions');

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
                const jsonPath = row.dataset.path || '';

                if (e.altKey) {
                    // Alt+Click: expand/collapse all descendants
                    this.setCollapseStateRecursive(row, willCollapse);
                    // Bulk update tracked JSON state for all descendants
                    if (willCollapse) {
                        // Collapsing all: remove this path and all children
                        if (jsonPath) {
                            for (const p of this.inspectorExpandedJsonPaths) {
                                if (p === jsonPath || p.startsWith(jsonPath + '.')) {
                                    this.inspectorExpandedJsonPaths.delete(p);
                                }
                            }
                        }
                    } else {
                        // Expanding all: add all collapsible descendants
                        if (jsonPath) this.inspectorExpandedJsonPaths.add(jsonPath);
                        if (children) {
                            children.querySelectorAll('.collapsible[data-path]').forEach(el => {
                                if (el.dataset.path) this.inspectorExpandedJsonPaths.add(el.dataset.path);
                            });
                        }
                    }
                } else {
                    // Normal click: toggle just this item
                    row.classList.toggle('collapsed');
                    if (children) children.classList.toggle('collapsed');
                    toggle.textContent = willCollapse ? '▶' : '▼';
                    // Track state
                    if (jsonPath) {
                        if (willCollapse) this.inspectorExpandedJsonPaths.delete(jsonPath);
                        else this.inspectorExpandedJsonPaths.add(jsonPath);
                    }
                }
            });
        });

        // Add click handlers for asset links in entity assets section
        this.inspectorEl.querySelectorAll('.asset-link-row').forEach(row => {
            row.addEventListener('click', () => {
                const searchQuery = row.dataset.searchQuery;
                if (searchQuery) {
                    this.switchTab('assets');
                    // Use search to find the asset
                    if (this.assetSearchInput) {
                        this.assetSearchInput.value = searchQuery;
                        this.assetFilter = searchQuery;
                        this.saveSetting('asset-filter', searchQuery);
                    }
                    // Trigger search
                    this.send('REQUEST_SEARCH_ASSETS', { query: searchQuery });
                }
            });
        });

        // Add instruction refresh button handlers
        this.inspectorEl.querySelectorAll('.instruction-refresh-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const eid = Number(btn.dataset.entityId);
                if (eid) {
                    this.instructionCache.delete(eid);
                    this.pendingInstructionFetches.delete(eid);
                    this.requestEntityInstructions(eid);
                }
            });
        });

        // Event log: clear button
        this.inspectorEl.querySelectorAll('.instruction-event-clear-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const eid = Number(btn.dataset.entityId);
                if (eid) {
                    this.instructionHistory.delete(eid);
                    this.renderInspector();
                }
            });
        });

        // Event log: restore scroll (sticky-bottom if user was at bottom, otherwise preserve position)
        this.inspectorEl.querySelectorAll('.instruction-timeline').forEach(list => {
            if (this.eventLogScrollAtBottom) {
                list.scrollTop = list.scrollHeight;
            } else {
                list.scrollTop = this.eventLogScroll;
            }
        });

        // Event log resize handle (mousedown only — move/up use persistent handlers)
        this.inspectorEl.querySelectorAll('.event-log-resize-handle').forEach(handle => {
            handle.addEventListener('mousedown', (e) => {
                const eventLog = handle.nextElementSibling;
                if (!eventLog) return;
                this._eventLogDrag = { startY: e.clientY, startHeight: eventLog.offsetHeight, target: eventLog, handle };
                handle.classList.add('dragging');
                document.body.style.cursor = 'row-resize';
                document.body.style.userSelect = 'none';
                e.preventDefault();
            });
        });

        // Instruction node collapse toggles (click on header text, not the arrow)
        // Alt+Click: expand/collapse all descendant nodes under the clicked node
        this.inspectorEl.querySelectorAll('.instruction-node-header .node-header-text').forEach(text => {
            text.addEventListener('click', (e) => {
                e.stopPropagation();
                if (e.altKey) {
                    // Alt+Click: toggle all descendants under this node
                    const node = text.closest('.instruction-node');
                    if (!node) return;
                    const descendantBodies = node.querySelectorAll('.instruction-node-body');
                    const anyExpanded = Array.from(descendantBodies).some(b => !b.classList.contains('collapsed'));
                    descendantBodies.forEach(b => b.classList.toggle('collapsed', anyExpanded));
                    node.querySelectorAll('.node-toggle').forEach(t => {
                        t.textContent = anyExpanded ? '▶' : '▼';
                    });
                    // Bulk update tracked state for this node + descendants
                    const nodePath = node.dataset.nodePath || '';
                    if (anyExpanded) {
                        for (const p of this.inspectorExpandedNodes) {
                            if (p === nodePath || p.startsWith(nodePath + '/')) {
                                this.inspectorExpandedNodes.delete(p);
                            }
                        }
                    } else {
                        // Add the clicked node itself
                        if (nodePath && node.querySelector(':scope > .instruction-node-body')) {
                            this.inspectorExpandedNodes.add(nodePath);
                        }
                        // Add all descendant nodes
                        node.querySelectorAll('.instruction-node[data-node-path]').forEach(el => {
                            if (el.querySelector(':scope > .instruction-node-body')) {
                                this.inspectorExpandedNodes.add(el.dataset.nodePath);
                            }
                        });
                    }
                } else {
                    const node = text.closest('.instruction-node');
                    const body = node.querySelector(':scope > .instruction-node-body');
                    if (!body) return;
                    const toggle = node.querySelector(':scope > .instruction-node-header .node-toggle');
                    const isCollapsed = body.classList.toggle('collapsed');
                    if (toggle) toggle.textContent = isCollapsed ? '▶' : '▼';
                    // Track state
                    const path = node.dataset.nodePath;
                    if (path) {
                        if (isCollapsed) this.inspectorExpandedNodes.delete(path);
                        else this.inspectorExpandedNodes.add(path);
                    }
                }
            });
        });

        // Set/clear surname: right-click on header or click pencil button
        this.inspectorEl.querySelectorAll('.instruction-node[data-node-path]').forEach(node => {
            const header = node.querySelector(':scope > .instruction-node-header');
            if (!header) return;

            const promptSurname = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const nodePath = node.dataset.nodePath;
                const section = node.closest('.instruction-section[data-role-name]');
                const role = section?.dataset.roleName;
                if (!role || !nodePath) return;

                const current = this.getNodeSurname(role, nodePath) || '';
                const input = prompt(`Surname for [${nodePath}] (empty to clear):`, current);
                if (input === null) return;
                this.setNodeSurname(role, nodePath, input.trim());
                this._lastInspectorHtml = '';
                this.renderInspector();
            };

            header.addEventListener('contextmenu', promptSurname);

            const pencilBtn = header.querySelector('.node-surname-btn');
            if (pencilBtn) pencilBtn.addEventListener('click', promptSurname);
        });

        // Update expandable button states based on pause state
        this.updateExpandableStates();

        // Restore expand/collapse state from tracked Sets
        // (must happen BEFORE scroll restore — collapsing/expanding nodes changes content height)
        this.restoreInspectorState();

        // Re-apply font scale BEFORE scroll restore (zoom changes content heights)
        if (this._inspectorFontScale && this._inspectorFontScale != 100) {
            this.applyInspectorFontScale(this._inspectorFontScale);
        }

        // Restore scroll position from ratio (after state + zoom so heights are final)
        const newScrollEl = this.getSubTabScrollElement();
        if (newScrollEl) {
            const maxScroll = newScrollEl.scrollHeight - newScrollEl.clientHeight;
            newScrollEl.scrollTop = this.inspectorSubTabScroll[this.inspectorSubTab] * maxScroll;
        }
    }

    /**
     * Get the scrollable element for the currently active sub-tab.
     * Components tab: the subtab-content div itself scrolls.
     * Instructions tab: the .instructions-scroll-body scrolls.
     */
    getSubTabScrollElement() {
        const active = this.inspectorEl.querySelector('.inspector-subtab-content.active');
        if (!active) return null;
        if (this.inspectorSubTab === 'instructions') {
            return active.querySelector('.instructions-scroll-body') || active;
        }
        return active;
    }

    /**
     * Restore expand/collapse state after a re-render.
     * Sections default expanded, so we collapse the ones the user collapsed.
     * Instruction nodes and JSON trees default collapsed, so we expand the ones the user expanded.
     */
    restoreInspectorState() {
        // Restore collapsed component sections
        this.inspectorEl.querySelectorAll('.component-section[data-section-key]').forEach(section => {
            const key = section.dataset.sectionKey;
            if (this.inspectorCollapsedSections.has(key)) {
                const body = section.querySelector('.component-body');
                const toggle = section.querySelector('.component-header .toggle');
                if (body) body.classList.add('collapsed');
                if (toggle) toggle.textContent = '[+]';
            }
        });

        // Restore expanded instruction nodes
        this.inspectorEl.querySelectorAll('.instruction-node[data-node-path]').forEach(node => {
            const path = node.dataset.nodePath;
            if (this.inspectorExpandedNodes.has(path)) {
                const body = node.querySelector(':scope > .instruction-node-body');
                const toggle = node.querySelector(':scope > .instruction-node-header .node-toggle');
                if (body) body.classList.remove('collapsed');
                if (toggle) toggle.textContent = '▼';
            }
        });

        // Restore expanded JSON tree nodes
        this.inspectorEl.querySelectorAll('.collapsible[data-path]').forEach(row => {
            const path = row.dataset.path;
            if (this.inspectorExpandedJsonPaths.has(path)) {
                const children = row.nextElementSibling;
                const toggle = row.querySelector('.collapse-toggle');
                row.classList.remove('collapsed');
                if (children) children.classList.remove('collapsed');
                if (toggle) toggle.textContent = '▼';
            }
        });
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
            <div class="component-section" data-section-key="${escapeHtml(name)}">
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
            <div class="alarm-section component-section" data-section-key="ALARMS">
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
            <div class="timer-section component-section" data-section-key="TIMERS">
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
            <div class="sensor-section component-section" data-section-key="SENSORS">
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

    // ═══════════════════════════════════════════════════════════════
    // NPC INSTRUCTION INSPECTION
    // ═══════════════════════════════════════════════════════════════

    // ── Instruction Event History (client-side diffing) ──────────

    /**
     * Diff two instruction tree snapshots and return change events.
     */
    diffInstructionTrees(oldTree, newTree) {
        const events = [];

        // State machine transitions
        if (oldTree.stateMachine && newTree.stateMachine) {
            const os = oldTree.stateMachine;
            const ns = newTree.stateMachine;
            if (os.state !== ns.state || os.subState !== ns.subState) {
                const oldLabel = os.stateName ? `${os.state}.${os.subState} (${os.stateName})` : `${os.state}.${os.subState}`;
                const newLabel = ns.stateName ? `${ns.state}.${ns.subState} (${ns.stateName})` : `${ns.state}.${ns.subState}`;
                events.push({
                    timestamp: Date.now(),
                    type: 'state',
                    label: `State: ${oldLabel} → ${newLabel}`,
                    oldValue: oldLabel,
                    newValue: newLabel
                });
            }
        }

        // Diff instruction groups
        events.push(...this.diffInstructionGroup('Root', oldTree.rootInstructions, newTree.rootInstructions));
        events.push(...this.diffInstructionGroup('Interaction', oldTree.interactionInstructions, newTree.interactionInstructions));
        events.push(...this.diffInstructionGroup('Death', oldTree.deathInstructions, newTree.deathInstructions));

        return events;
    }

    /**
     * Diff two instruction node arrays (matched by index).
     */
    diffInstructionGroup(groupName, oldNodes, newNodes) {
        const events = [];
        if (!oldNodes || !newNodes) return events;

        const len = Math.min(oldNodes.length, newNodes.length);
        for (let i = 0; i < len; i++) {
            const oldNode = oldNodes[i];
            const newNode = newNodes[i];
            const ctx = oldNode.name ? `${groupName}[${i}] "${oldNode.name}"` : `${groupName}[${i}]`;

            // Diff sensor
            if (oldNode.sensor && newNode.sensor) {
                events.push(...this.diffSensor(oldNode.sensor, newNode.sensor, ctx));
            }

            // Diff actions
            if (oldNode.actions && newNode.actions) {
                events.push(...this.diffActions(oldNode.actions, newNode.actions, ctx));
            }

            // Recurse into children
            if (oldNode.children && newNode.children) {
                events.push(...this.diffInstructionGroup(ctx, oldNode.children, newNode.children));
            }
        }

        return events;
    }

    /**
     * Diff two sensor nodes (recursive for compound sensors).
     */
    diffSensor(oldSensor, newSensor, context) {
        const events = [];
        const now = Date.now();
        const sensorLabel = oldSensor.type || 'Sensor';

        // Alarm state transitions
        if (oldSensor.alarmActual !== undefined && newSensor.alarmActual !== undefined) {
            if (oldSensor.alarmActual !== newSensor.alarmActual) {
                const name = oldSensor.alarmName || 'unknown';
                events.push({
                    timestamp: now,
                    type: 'alarm',
                    label: `Alarm "${name}" ${oldSensor.alarmActual} → ${newSensor.alarmActual}`,
                    oldValue: oldSensor.alarmActual,
                    newValue: newSensor.alarmActual
                });
            }
        }

        // Timer state transitions (NOT value)
        if (oldSensor.timerActualState !== undefined && newSensor.timerActualState !== undefined) {
            if (oldSensor.timerActualState !== newSensor.timerActualState) {
                events.push({
                    timestamp: now,
                    type: 'timer',
                    label: `Timer ${context}: ${oldSensor.timerActualState} → ${newSensor.timerActualState}`,
                    oldValue: oldSensor.timerActualState,
                    newValue: newSensor.timerActualState
                });
            }
        }

        // Triggered flag flip
        if (oldSensor.triggered !== newSensor.triggered) {
            const verb = newSensor.triggered ? 'TRIGGERED' : 'cleared';
            events.push({
                timestamp: now,
                type: 'sensor',
                label: `Sensor ${sensorLabel} ${context} ${verb}`,
                oldValue: oldSensor.triggered,
                newValue: newSensor.triggered
            });
        }

        // Diff generic properties
        if (oldSensor.properties || newSensor.properties) {
            events.push(...this.diffProperties(
                oldSensor.properties || {}, newSensor.properties || {}, context, 'Sensor'));
        }

        // Recurse into compound sensor children
        if (oldSensor.children && newSensor.children) {
            const len = Math.min(oldSensor.children.length, newSensor.children.length);
            for (let i = 0; i < len; i++) {
                events.push(...this.diffSensor(oldSensor.children[i], newSensor.children[i], context));
            }
        }

        return events;
    }

    /**
     * Diff two action arrays (matched by index).
     */
    diffActions(oldActions, newActions, context) {
        const events = [];
        const now = Date.now();
        const len = Math.min(oldActions.length, newActions.length);

        for (let i = 0; i < len; i++) {
            const oa = oldActions[i];
            const na = newActions[i];
            const actionLabel = na.type || `Action[${i}]`;

            if (oa.triggered !== na.triggered) {
                const verb = na.triggered ? 'TRIGGERED' : 'cleared';
                events.push({
                    timestamp: now,
                    type: 'action',
                    label: `Action "${actionLabel}" ${verb}`,
                    oldValue: oa.triggered,
                    newValue: na.triggered
                });
            }

            if (oa.active !== na.active) {
                const verb = na.active ? 'ACTIVE' : 'inactive';
                events.push({
                    timestamp: now,
                    type: 'action',
                    label: `Action "${actionLabel}" ${verb}`,
                    oldValue: oa.active,
                    newValue: na.active
                });
            }

            // Diff generic properties
            if (oa.properties || na.properties) {
                events.push(...this.diffProperties(
                    oa.properties || {}, na.properties || {}, `${context} "${actionLabel}"`, 'Action'));
            }
        }

        return events;
    }

    /**
     * Compare two property maps and return events for changed/removed values.
     */
    diffProperties(oldProps, newProps, context, parentType) {
        const events = [];
        const now = Date.now();
        const allKeys = new Set([...Object.keys(oldProps), ...Object.keys(newProps)]);

        for (const key of allKeys) {
            const oldVal = oldProps[key];
            const newVal = newProps[key];

            if (!this.arePropertiesEqual(oldVal, newVal)) {
                const oldStr = this.formatPropertyValue(oldVal);
                const newStr = this.formatPropertyValue(newVal);
                events.push({
                    timestamp: now,
                    type: parentType === 'Action' ? 'action' : 'sensor',
                    label: `${parentType} ${context}: ${key} ${oldStr} \u2192 ${newStr}`,
                    oldValue: oldStr,
                    newValue: newStr
                });
            }
        }
        return events;
    }

    /**
     * Deep equality for property values (primitives and arrays).
     */
    arePropertiesEqual(a, b) {
        if (a === b) return true;
        if (a === undefined && b === undefined) return true;
        if (a === null && b === null) return true;
        if (a === undefined || a === null || b === undefined || b === null) return false;
        if (Array.isArray(a) && Array.isArray(b)) {
            if (a.length !== b.length) return false;
            for (let i = 0; i < a.length; i++) {
                if (a[i] !== b[i]) return false;
            }
            return true;
        }
        return false;
    }

    /**
     * Format a property value for display in event labels.
     */
    formatPropertyValue(value) {
        if (value === undefined || value === null) return '(none)';
        if (typeof value === 'boolean') return value ? '\u2713' : '\u2717';
        if (Array.isArray(value)) return '[' + value.join(', ') + ']';
        return String(value);
    }

    /**
     * Append events to the ring buffer for an entity, trimming to max.
     */
    appendInstructionEvents(entityId, events) {
        let history = this.instructionHistory.get(entityId);
        if (!history) {
            history = [];
            this.instructionHistory.set(entityId, history);
        }
        history.push(...events);
        // Trim to max
        if (history.length > this.maxInstructionEvents) {
            history.splice(0, history.length - this.maxInstructionEvents);
        }
    }

    // ── End Instruction Event History ────────────────────────────

    handleEntityInstructions(data) {
        if (!data || !data.entityId) return;

        this.pendingInstructionFetches.delete(data.entityId);

        if (data.instructions) {
            // Diff against previous snapshot before updating cache
            const old = this.previousInstructionSnapshot.get(data.entityId);
            if (old) {
                const events = this.diffInstructionTrees(old, data.instructions);
                if (events.length > 0) {
                    this.appendInstructionEvents(data.entityId, events);
                }
            }
            // Store snapshot for next diff (deep copy via structured clone)
            this.previousInstructionSnapshot.set(data.entityId, JSON.parse(JSON.stringify(data.instructions)));
            this.instructionCache.set(data.entityId, data.instructions);
        }

        // Re-render inspector if this entity is selected
        if (this.selectedEntityId === data.entityId && !this.inspectorPaused) {
            this.renderInspector();
        }
    }

    requestEntityInstructions(entityId) {
        if (this.pendingInstructionFetches.has(entityId)) return;
        this.pendingInstructionFetches.add(entityId);
        this.send('REQUEST_ENTITY_INSTRUCTIONS', { entityId });
    }

    /**
     * Render the instruction tree section for the inspector panel.
     */
    renderInstructionsSection(entityId) {
        const tree = this.instructionCache.get(entityId);
        if (!tree) {
            // Trigger fetch if not cached
            if (!this.pendingInstructionFetches.has(entityId)) {
                this.requestEntityInstructions(entityId);
            }
            return '';
        }

        const roleName = tree.roleName || '';

        let html = `
            <div class="instruction-section component-section" data-section-key="INSTRUCTIONS" data-role-name="${escapeHtml(roleName)}">
                <div class="component-header">
                    <span class="toggle">[-]</span>
                    <span class="component-name">🧠 INSTRUCTIONS</span>
                    <span class="instruction-role-name">${escapeHtml(roleName)}</span>
                    <button class="instruction-refresh-btn" data-entity-id="${entityId}" title="Refresh Instructions">↻</button>
                </div>
                <div class="component-body">
        `;

        // State machine
        if (tree.stateMachine) {
            const sm = tree.stateMachine;
            const nameStr = sm.stateName ? ` (${escapeHtml(sm.stateName)})` : '';
            html += `
                <div class="instruction-state-machine">
                    <span class="instruction-label">State:</span>
                    <span class="instruction-value">${sm.state}${nameStr}</span>
                    <span class="instruction-label">Sub:</span>
                    <span class="instruction-value">${sm.subState}</span>
                </div>
            `;
        }

        // Parameters (collapsible)
        if (tree.parameters && Object.keys(tree.parameters).length > 0) {
            html += `
                <div class="instruction-params">
                    <div class="instruction-params-header collapsible collapsed" data-path="instruction-parameters">
                        <span class="collapse-toggle">▶</span>
                        <span class="instruction-label">Parameters (${Object.keys(tree.parameters).length})</span>
                    </div>
                    <div class="instruction-params-body collapsed">
            `;
            for (const [key, value] of Object.entries(tree.parameters)) {
                html += `
                    <div class="instruction-param-row">
                        <span class="param-key">${escapeHtml(key)}</span>
                        <span class="param-value">${escapeHtml(JSON.stringify(value))}</span>
                    </div>
                `;
            }
            html += '</div></div>';
        }

        // Root instructions
        if (tree.rootInstructions && tree.rootInstructions.length > 0) {
            html += `<div class="instruction-group">
                <div class="instruction-group-header">Root Instructions (${tree.rootInstructions.length})</div>`;
            html += this.renderInstructionNodes(tree.rootInstructions, 0, 'root', roleName);
            html += '</div>';
        }

        // Interaction instructions
        if (tree.interactionInstructions && tree.interactionInstructions.length > 0) {
            html += `<div class="instruction-group">
                <div class="instruction-group-header">Interaction Instructions (${tree.interactionInstructions.length})</div>`;
            html += this.renderInstructionNodes(tree.interactionInstructions, 0, 'interaction', roleName);
            html += '</div>';
        }

        // Death instructions
        if (tree.deathInstructions && tree.deathInstructions.length > 0) {
            html += `<div class="instruction-group">
                <div class="instruction-group-header">Death Instructions (${tree.deathInstructions.length})</div>`;
            html += this.renderInstructionNodes(tree.deathInstructions, 0, 'death', roleName);
            html += '</div>';
        }

        html += '</div></div>';
        return html;
    }

    /**
     * Render the instruction event history log as a vertical timeline.
     */
    renderInstructionEventLog(entityId, roleName = '') {
        const history = this.instructionHistory.get(entityId) || [];
        const count = history.length;

        let html = `
            <div class="instruction-event-log component-section" data-section-key="EVENT LOG" style="height:${this.eventLogMaxHeight || 240}px">
                <div class="component-header">
                    <span class="toggle">[-]</span>
                    <span class="component-name">EVENT LOG (${count})</span>
                    ${count > 0 ? `<button class="instruction-event-clear-btn" data-entity-id="${entityId}" title="Clear event log">✕</button>` : ''}
                </div>
                <div class="component-body">
                    <div class="instruction-timeline" data-entity-id="${entityId}">
        `;

        if (count === 0) {
            html += '<div class="instruction-event-empty">No events yet. Changes will appear as the inspector polls.</div>';
        } else {
            for (const event of history) {
                const time = new Date(event.timestamp);
                const timeStr = time.toLocaleTimeString('en-GB', { hour12: false });
                // Resolve surnames in event labels
                const label = roleName ? this.resolveEventLabel(event.label, roleName) : event.label;
                html += `
                    <div class="instruction-event event-type-${escapeHtml(event.type)}">
                        <span class="event-time">${timeStr}</span>
                        <span class="event-label">${escapeHtml(label)}</span>
                    </div>
                `;
            }
        }

        html += '</div></div></div>';
        return html;
    }

    /**
     * Build a compact one-line summary of a sensor for the node header.
     * e.g. "And(Alarm "Growth_Ready", Timer)" or "Alarm "Harvest_Ready""
     */
    getSensorSummary(sensor) {
        if (!sensor) return '';
        const type = escapeHtml(sensor.type || '?');

        // Build params string for leaf sensors
        const params = [];
        if (sensor.alarmName) {
            params.push(`"${escapeHtml(sensor.alarmName)}" expect:${escapeHtml(sensor.alarmExpected || '?')}`);
        }
        if (sensor.timerExpectedState) {
            params.push(`expect:${escapeHtml(sensor.timerExpectedState)}`);
        }
        const paramStr = params.length > 0 ? ' ' + params.join(' ') : '';

        // Build properties string for non-alarm/non-timer sensors
        let propsStr = '';
        if (sensor.properties && Object.keys(sensor.properties).length > 0) {
            propsStr = Object.entries(sensor.properties)
                .filter(([k, v]) => v !== false && v !== 0 && v !== null)
                .map(([k, v]) => {
                    if (typeof v === 'boolean') return v ? k : null;
                    if (typeof v === 'number') return `${k}:${v}`;
                    if (typeof v === 'string') return `${k}:${v}`;
                    if (Array.isArray(v)) return `${k}:[${v.join(',')}]`;
                    return null;
                })
                .filter(Boolean)
                .join(', ');
        }

        // Compound sensors: recurse into children
        if (sensor.children && sensor.children.length > 0) {
            const inner = sensor.children.map(c => this.getSensorSummary(c)).join(', ');
            const extra = propsStr ? ` (${propsStr})` : '';
            return `${type}(${inner})${extra}`;
        }

        // Leaf sensor: combine params and properties
        const allParts = [paramStr.trim(), propsStr ? `(${propsStr})` : ''].filter(Boolean).join(' ');
        return `${type}${allParts ? ' ' + allParts : ''}`;
    }

    /**
     * Render a list of instruction nodes recursively.
     */
    renderInstructionNodes(nodes, depth, pathPrefix = '', roleName = '') {
        if (!nodes || nodes.length === 0) return '';

        let html = '';
        for (const node of nodes) {
            const nodePath = pathPrefix ? `${pathPrefix}.${node.index}` : `${node.index}`;
            const surname = roleName ? this.getNodeSurname(roleName, nodePath) : undefined;
            const surnameStr = surname ? ` <span class="node-surname">${escapeHtml(surname)}</span>` : '';
            const nameStr = node.name ? ` "${escapeHtml(node.name)}"` : '';
            const tagStr = node.tag ? ` <span class="instruction-tag">[${escapeHtml(node.tag)}]</span>` : '';
            const contStr = node.continueAfter ? ' <span class="instruction-continue">→ continue</span>' : '';
            const sensorStr = node.sensor ? ` <span class="instruction-sensor-summary">${this.getSensorSummary(node.sensor)}</span>` : '';
            const hasContent = node.sensor || (node.actions && node.actions.length > 0) || (node.children && node.children.length > 0);

            html += `<div class="instruction-node" data-node-path="${escapeHtml(nodePath)}" style="padding-left: ${depth * 16}px">`;
            html += `<div class="instruction-node-header">`;
            if (hasContent) {
                html += `<span class="node-toggle">▶</span>`;
            }
            html += `<span class="node-header-text${hasContent ? ' collapsible-text' : ''}"><span class="instruction-index">[${node.index}]</span>${surnameStr}${nameStr}${tagStr}${contStr}${sensorStr}</span>`;
            html += `<button class="node-surname-btn" title="Set surname for this node">&#9998; Rename (right-click)</button>`;
            html += `</div>`;

            if (hasContent) {
                html += `<div class="instruction-node-body collapsed">`;

                // Sensor
                if (node.sensor) {
                    html += this.renderSensorNode(node.sensor, depth + 1);
                }

                // Actions
                if (node.actions && node.actions.length > 0) {
                    html += `<div class="instruction-actions" style="padding-left: ${(depth + 1) * 16}px">`;
                    html += '<span class="instruction-label">Actions:</span> ';
                    html += node.actions.map(a => {
                        const flags = [];
                        if (a.once) flags.push('once');
                        if (a.triggered) flags.push('TRIGGERED');
                        if (a.active) flags.push('ACTIVE');
                        const flagClass = a.active ? 'action-active' : a.triggered ? 'action-triggered' : '';
                        const flagStr = flags.length > 0 ? ` <span class="action-flags">[${flags.join(', ')}]</span>` : '';
                        let propStr = '';
                        if (a.properties && Object.keys(a.properties).length > 0) {
                            propStr = ' <span class="action-properties">';
                            for (const [key, value] of Object.entries(a.properties)) {
                                let displayValue;
                                if (typeof value === 'boolean') displayValue = value ? '\u2713' : '\u2717';
                                else if (Array.isArray(value)) displayValue = '[' + value.join(', ') + ']';
                                else displayValue = escapeHtml(String(value));
                                propStr += `<span class="action-prop">${escapeHtml(key)}=${displayValue}</span> `;
                            }
                            propStr += '</span>';
                        }
                        return `<span class="action-badge ${flagClass}">${escapeHtml(a.type)}${flagStr}${propStr}</span>`;
                    }).join(' ');
                    html += '</div>';
                }

                // Children (sub-instructions)
                if (node.children && node.children.length > 0) {
                    html += this.renderInstructionNodes(node.children, depth + 1, nodePath, roleName);
                }

                html += '</div>';
            }

            html += '</div>';
        }
        return html;
    }

    /**
     * Render a sensor node (recursive for compound sensors).
     */
    renderSensorNode(sensor, depth) {
        if (!sensor) return '';

        let html = `<div class="sensor-node" style="padding-left: ${depth * 16}px">`;
        html += `<span class="sensor-type">${escapeHtml(sensor.type)}</span>`;

        // Alarm-specific info
        if (sensor.alarmName) {
            const actualClass = (sensor.alarmActual || '').toLowerCase();
            html += ` <span class="sensor-alarm-name">"${escapeHtml(sensor.alarmName)}"</span>`;
            html += ` <span class="sensor-alarm-expect">(expect: ${escapeHtml(sensor.alarmExpected || '?')}</span>`;
            html += ` <span class="sensor-alarm-actual alarm-state-${actualClass}">actual: ${escapeHtml(sensor.alarmActual || '?')}</span>`;
            if (sensor.alarmClear) html += ` <span class="sensor-alarm-clear">clear</span>`;
            html += '<span class="sensor-alarm-expect">)</span>';
        }

        // Timer-specific info
        if (sensor.timerExpectedState || sensor.timerActualState) {
            const actualClass = (sensor.timerActualState || '').toLowerCase();
            html += ` <span class="sensor-timer-info">(`;
            html += `expect: ${escapeHtml(sensor.timerExpectedState || '?')}`;
            html += ` <span class="timer-state-${actualClass}">actual: ${escapeHtml(sensor.timerActualState || '?')}</span>`;
            if (sensor.timerValue !== undefined && sensor.timerValue !== null) {
                html += ` val: ${sensor.timerValue.toFixed(1)}`;
                if (sensor.timerMaxValue !== undefined && sensor.timerMaxValue !== null) {
                    html += `/${sensor.timerMaxValue.toFixed(1)}`;
                }
            }
            html += `)</span>`;
        }

        // Runtime flags
        const flags = [];
        if (sensor.once) flags.push('once');
        if (sensor.triggered) flags.push('TRIGGERED');
        if (flags.length > 0) {
            const flagClass = sensor.triggered ? 'sensor-triggered' : '';
            html += ` <span class="sensor-flags ${flagClass}">[${flags.join(', ')}]</span>`;
        }

        // Generic properties
        if (sensor.properties && Object.keys(sensor.properties).length > 0) {
            html += ` <span class="sensor-properties">`;
            for (const [key, value] of Object.entries(sensor.properties)) {
                let displayValue;
                if (typeof value === 'boolean') displayValue = value ? '\u2713' : '\u2717';
                else if (Array.isArray(value)) displayValue = '[' + value.join(', ') + ']';
                else displayValue = escapeHtml(String(value));
                html += `<span class="sensor-prop">${escapeHtml(key)}=${displayValue}</span> `;
            }
            html += `</span>`;
        }

        html += '</div>';

        // Compound sensor children
        if (sensor.children && sensor.children.length > 0) {
            for (let i = 0; i < sensor.children.length; i++) {
                const child = sensor.children[i];
                const isLast = i === sensor.children.length - 1;
                const prefix = isLast ? '└─' : '├─';
                html += `<div class="sensor-child" style="padding-left: ${(depth + 1) * 16}px">`;
                html += `<span class="sensor-tree-line">${prefix}</span> `;
                // Inline render the child sensor (without extra wrapper div)
                html += `<span class="sensor-type">${escapeHtml(child.type)}</span>`;

                // Alarm info for child
                if (child.alarmName) {
                    const actualClass = (child.alarmActual || '').toLowerCase();
                    html += ` <span class="sensor-alarm-name">"${escapeHtml(child.alarmName)}"</span>`;
                    html += ` <span class="sensor-alarm-actual alarm-state-${actualClass}">${escapeHtml(child.alarmActual || '?')}</span>`;
                    if (child.alarmClear) html += ` <span class="sensor-alarm-clear">clear</span>`;
                }

                // Timer info for child
                if (child.timerExpectedState || child.timerActualState) {
                    const actualClass = (child.timerActualState || '').toLowerCase();
                    html += ` <span class="timer-state-${actualClass}">${escapeHtml(child.timerActualState || '?')}</span>`;
                    if (child.timerValue !== undefined && child.timerValue !== null) {
                        html += ` ${child.timerValue.toFixed(1)}`;
                        if (child.timerMaxValue !== undefined && child.timerMaxValue !== null) {
                            html += `/${child.timerMaxValue.toFixed(1)}`;
                        }
                    }
                }

                // Flags for child
                const childFlags = [];
                if (child.once) childFlags.push('once');
                if (child.triggered) childFlags.push('TRIGGERED');
                if (childFlags.length > 0) {
                    const flagClass = child.triggered ? 'sensor-triggered' : '';
                    html += ` <span class="sensor-flags ${flagClass}">[${childFlags.join(', ')}]</span>`;
                }

                // Properties for child
                if (child.properties && Object.keys(child.properties).length > 0) {
                    html += ` <span class="sensor-properties">`;
                    for (const [key, value] of Object.entries(child.properties)) {
                        let displayValue;
                        if (typeof value === 'boolean') displayValue = value ? '\u2713' : '\u2717';
                        else if (Array.isArray(value)) displayValue = '[' + value.join(', ') + ']';
                        else displayValue = escapeHtml(String(value));
                        html += `<span class="sensor-prop">${escapeHtml(key)}=${displayValue}</span> `;
                    }
                    html += `</span>`;
                }

                html += '</div>';

                // Recurse for nested compound sensors
                if (child.children && child.children.length > 0) {
                    for (const grandchild of child.children) {
                        html += this.renderSensorNode(grandchild, depth + 2);
                    }
                }
            }
        }

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

            // Extract surname from LaitInspectorComponent
            const inspector = entity.components?.LaitInspectorComponent;
            const surname = inspector?.fields?.surname || '';

            allAlarms.push({
                entityId,
                name,
                surname,
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
                const surnameMatch = entry.surname.toLowerCase().includes(this.alarmsFilter);
                return nameMatch || idMatch || surnameMatch;
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
                    <div class="alarm-actions">
                        <span class="entity-surname">${escapeHtml(entry.surname) || '---'}</span>
                        <button class="action-btn edit-btn" data-entity-id="${entry.entityId}" data-current="${escapeHtml(entry.surname)}" title="Edit surname">✎</button>
                        <button class="action-btn tp-btn" data-entity-id="${entry.entityId}" title="Teleport to entity">TP</button>
                    </div>
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

        // Add click handlers for teleport buttons
        this.alarmsPanel.querySelectorAll('.tp-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const entityId = parseInt(btn.dataset.entityId);
                this.requestTeleportTo(entityId);
            });
        });

        // Add click handlers for edit surname buttons
        this.alarmsPanel.querySelectorAll('.edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const entityId = parseInt(btn.dataset.entityId);
                const currentSurname = btn.dataset.current || '';
                this.openSurnameEditor(entityId, currentSurname);
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

        // When paused, freeze the display - don't update anything
        if (this.liveChangesPaused) {
            // If there's no frozen content yet, show empty state
            if (!this.liveChangesContent.dataset.frozen) {
                if (this.globalChanges.length === 0) {
                    this.liveChangesContent.innerHTML = `
                        <div class="empty-state small">
                            <pre>Paused - Click PLAY to start tracking</pre>
                        </div>`;
                }
                // Otherwise keep whatever is currently displayed (frozen)
            }
            return;
        }

        // Clear frozen flag when running
        delete this.liveChangesContent.dataset.frozen;

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
        let uniqueChanges = Array.from(seen.values())
            .sort((a, b) => a.timestamp - b.timestamp); // Oldest first for left-to-right stack

        // Apply filters
        if (this.liveFilterEntityValue) {
            uniqueChanges = uniqueChanges.filter(c =>
                c.entityName.toLowerCase().includes(this.liveFilterEntityValue)
            );
        }
        if (this.liveFilterIdValue) {
            uniqueChanges = uniqueChanges.filter(c =>
                String(c.entityId).includes(this.liveFilterIdValue)
            );
        }
        if (this.liveFilterComponentValue) {
            uniqueChanges = uniqueChanges.filter(c =>
                c.componentName.toLowerCase().includes(this.liveFilterComponentValue)
            );
        }

        // Limit to max chips
        uniqueChanges = uniqueChanges.slice(-this.maxGlobalChips); // Take newest N

        if (uniqueChanges.length === 0) {
            this.liveChangesContent.innerHTML = `
                <div class="empty-state small">
                    <pre>No matching changes${this.liveFilterEntityValue || this.liveFilterIdValue || this.liveFilterComponentValue ? ' (filters active)' : '...'}</pre>
                </div>`;
            return;
        }

        this.liveChangesContent.innerHTML = uniqueChanges
            .map(c => `
                <div class="live-change-chip" data-entity-id="${c.entityId}" title="Click to select entity">
                    <span class="entity-name">${escapeHtml(c.entityName)}</span>
                    <span class="component-name">${escapeHtml(c.componentName)}</span>
                </div>
            `)
            .join('');

        // Auto-scroll to the right to show newest changes
        this.liveChangesContent.scrollLeft = this.liveChangesContent.scrollWidth;

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

        if (this.liveChangesPaused) {
            // Mark content as frozen when pausing
            if (this.liveChangesContent) {
                this.liveChangesContent.dataset.frozen = 'true';
            }
        } else {
            // Clear old changes when resuming for fresh start
            this.globalChanges = [];
            if (this.liveChangesContent) {
                delete this.liveChangesContent.dataset.frozen;
            }
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

    // ═══════════════════════════════════════════════════════════════
    // PANEL VISIBILITY TOGGLES
    // ═══════════════════════════════════════════════════════════════

    togglePacketPanelVisibility() {
        this.packetPanelVisible = !this.packetPanelVisible;
        this.saveSetting('packet-panel-visible', this.packetPanelVisible);
        this.updatePanelVisibility();
    }

    toggleLivePanelVisibility() {
        this.livePanelVisible = !this.livePanelVisible;
        this.saveSetting('live-panel-visible', this.livePanelVisible);
        this.updatePanelVisibility();
    }

    updatePanelVisibility() {
        // Update packet log panel
        if (this.packetLogPanel) {
            this.packetLogPanel.classList.toggle('panel-hidden', !this.packetPanelVisible);
        }
        if (this.togglePacketsBtn) {
            this.togglePacketsBtn.classList.toggle('active', this.packetPanelVisible);
            this.togglePacketsBtn.classList.toggle('inactive', !this.packetPanelVisible);
        }

        // Update live changes panel
        if (this.liveChangesPanel) {
            this.liveChangesPanel.classList.toggle('panel-hidden', !this.livePanelVisible);
        }
        if (this.toggleLiveBtn) {
            this.toggleLiveBtn.classList.toggle('active', this.livePanelVisible);
            this.toggleLiveBtn.classList.toggle('inactive', !this.livePanelVisible);
        }
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
            // Include surname from LaitInspectorComponent in search
            const surname = (entity.components?.LaitInspectorComponent?.fields?.surname || '').toLowerCase();
            return type.includes(search) || model.includes(search) || id.includes(search) || surname.includes(search);
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

        // Clear tracked inspector UI state for fresh entity view
        this.inspectorExpandedNodes.clear();
        this.inspectorCollapsedSections.clear();
        this.inspectorExpandedJsonPaths.clear();
        this._lastInspectorHtml = '';

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

    startInstructionPoll() {
        setInterval(() => {
            if (this.inspectorPaused || !this.selectedEntityId) return;
            const entity = this.entities.get(this.selectedEntityId);
            if (!entity) return;
            if (entity.entityType === 'NPC' || entity.components?.NPCEntity) {
                this.requestEntityInstructions(entity.entityId);
            }
        }, 500);
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

        // Inspector fullscreen button
        if (this.inspectorFullscreenBtn) {
            this.inspectorFullscreenBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleInspectorFullscreen();
            });
        }

        // Inspector font scale slider
        if (this.inspectorFontScaleInput) {
            const savedScale = localStorage.getItem(STORAGE_PREFIX + 'inspector-font-scale') || '100';
            this.inspectorFontScaleInput.value = savedScale;
            this.inspectorFontScaleValue.textContent = savedScale + '%';
            this.applyInspectorFontScale(savedScale);
            this.inspectorFontScaleInput.addEventListener('input', (e) => {
                const val = e.target.value;
                this.inspectorFontScaleValue.textContent = val + '%';
                this.applyInspectorFontScale(val);
                localStorage.setItem(STORAGE_PREFIX + 'inspector-font-scale', val);
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

        // Live changes filter inputs
        if (this.liveFilterEntity) {
            this.liveFilterEntity.addEventListener('input', (e) => {
                this.liveFilterEntityValue = e.target.value.trim().toLowerCase();
                this.saveSetting('live-filter-entity', this.liveFilterEntityValue);
                this.renderLiveChanges();
            });
        }
        if (this.liveFilterId) {
            this.liveFilterId.addEventListener('input', (e) => {
                this.liveFilterIdValue = e.target.value.trim();
                this.saveSetting('live-filter-id', this.liveFilterIdValue);
                this.renderLiveChanges();
            });
        }
        if (this.liveFilterComponent) {
            this.liveFilterComponent.addEventListener('input', (e) => {
                this.liveFilterComponentValue = e.target.value.trim().toLowerCase();
                this.saveSetting('live-filter-component', this.liveFilterComponentValue);
                this.renderLiveChanges();
            });
        }

        // Panel visibility toggle buttons (footer)
        if (this.togglePacketsBtn) {
            this.togglePacketsBtn.addEventListener('click', () => {
                this.togglePacketPanelVisibility();
            });
        }
        if (this.toggleLiveBtn) {
            this.toggleLiveBtn.addEventListener('click', () => {
                this.toggleLivePanelVisibility();
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

        // Refresh assets button
        if (this.refreshAssetsBtn) {
            this.refreshAssetsBtn.addEventListener('click', () => {
                this.refreshAssets();
            });
        }

        // Patch button
        if (this.patchBtn) {
            this.patchBtn.addEventListener('click', () => {
                this.openPatchModal();
            });
        }

        // Refresh asset button (re-fetches current asset from game API)
        if (this.refreshAssetBtn) {
            this.refreshAssetBtn.addEventListener('click', () => {
                this.refreshCurrentAsset();
            });
        }
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

    /**
     * Refresh the currently displayed asset by re-fetching from game API.
     */
    refreshCurrentAsset() {
        if (!this.assetDetail) {
            this.log('No asset selected to refresh', 'warn');
            return;
        }

        const category = this.assetDetail.category;
        const assetId = this.assetDetail.id;

        this.log(`Refreshing asset: ${category}/${assetId}`, 'info');
        this.requestAssetDetail(category, assetId);
    }

    requestSearchAssets(query) {
        this.send('REQUEST_SEARCH_ASSETS', { query });
    }

    /**
     * Request a full asset refresh from the server.
     * This re-scans all asset packs to pick up mod/patch changes.
     */
    refreshAssets() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.log('Cannot refresh: not connected', 'error');
            return;
        }

        // Update button to loading state
        if (this.refreshAssetsBtn) {
            this.refreshAssetsBtn.classList.add('loading');
            this.refreshAssetsBtn.disabled = true;
            this.refreshAssetsBtn.textContent = '↻ Refreshing...';
        }

        this.send('REFRESH_ASSETS');
        this.log('Requested asset refresh', 'info');
    }

    /**
     * Handle ASSETS_REFRESHED response from server.
     * Preserves UI state (expanded categories, selected asset, scroll position).
     */
    handleAssetsRefreshed(data) {
        this.log('Assets refreshed successfully', 'connect');

        // Reset button state
        if (this.refreshAssetsBtn) {
            this.refreshAssetsBtn.classList.remove('loading');
            this.refreshAssetsBtn.disabled = false;
            this.refreshAssetsBtn.textContent = '↻ REFRESH';
        }

        // Preserve scroll position
        const assetTree = document.getElementById('asset-tree');
        const scrollTop = assetTree?.scrollTop || 0;

        // Preserve expanded categories (don't clear)
        // Preserve selected asset (don't clear this.selectedAsset or this.selectedCategory)

        // Clear cached data but keep UI state
        this.assetCategories = [];
        this.categoryAssets = {};
        this.loadingCategories.clear();
        this.searchResults = {};

        // Set flag to restore scroll after render
        this._pendingScrollRestore = scrollTop;

        // Request fresh categories (handleAssetCategories will trigger search if needed)
        this.requestAssetCategories();

        // Auto-refresh if currently viewing the patched asset
        const patchedPath = data?.patchedAssetPath;
        if (patchedPath && this.assetDetail?.id === patchedPath) {
            this.log(`Auto-refreshing patched asset: ${patchedPath}`, 'info');
            // Re-request the asset detail
            this.requestAssetDetail(this.selectedCategory, this.selectedAsset);

            // If patch modal is still open, refresh the original pane
            if (!this.patchModal?.classList.contains('hidden')) {
                this.refreshPatchModalAsset();
            }
        }
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

        // Restore scroll position if pending (from refresh)
        if (this._pendingScrollRestore !== undefined) {
            const assetTree = document.getElementById('asset-tree');
            if (assetTree) {
                assetTree.scrollTop = this._pendingScrollRestore;
            }
            delete this._pendingScrollRestore;
        }

        // Apply search filter if present (persisted or current)
        const searchQuery = this.assetFilterInput?.value?.trim();
        if (searchQuery && searchQuery.length >= 2) {
            this.requestSearchAssets(searchQuery);
        }
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
        // Check if this is a pending modal refresh (user clicked refresh in patch modal)
        if (this._pendingModalRefresh?.category === data.category &&
            this._pendingModalRefresh?.assetId === data.id) {
            this._pendingModalRefresh = null;

            // Update only the original pane, preserve user's modifications
            const rawJson = data.rawJson || JSON.stringify(data.content, null, 2);
            if (this.originalJson) this.originalJson.textContent = rawJson;
            this.assetDetail = data;

            // Reset button loading state
            this.refreshOriginalBtn?.classList.remove('loading');

            // Regenerate patch preview with new original vs current modified
            this.updatePatchPreview();
            return;
        }

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

        // Render Favorites category at top (only if not searching and has favorites)
        const favoriteAssets = this.getFavoriteAssets();
        if (!hasSearchResults && favoriteAssets.length > 0) {
            const favExpanded = this.expandedCategories.has('_favorites');
            html += `
                <div class="tree-category favorites ${favExpanded ? '' : 'collapsed'}" data-category="_favorites">
                    <div class="tree-category-header favorites-header">
                        <span class="tree-category-toggle">▼</span>
                        <span class="tree-category-name">★ Favorites</span>
                        <span class="tree-category-count">${favoriteAssets.length}</span>
                    </div>
                    <div class="tree-assets">
            `;
            for (const fav of favoriteAssets) {
                const isSelected = this.selectedAsset === fav.assetId && this.selectedCategory === fav.category;
                html += `
                    <div class="tree-asset ${isSelected ? 'selected' : ''}"
                         data-asset-id="${escapeHtml(fav.assetId)}"
                         data-category="${escapeHtml(fav.category)}">
                        <button class="favorite-btn active" data-fav-category="${escapeHtml(fav.category)}" data-fav-asset="${escapeHtml(fav.assetId)}" title="Remove from favorites">★</button>
                        <span class="tree-asset-id">${escapeHtml(fav.assetId)}</span>
                        <span class="tree-asset-category">${escapeHtml(fav.category)}</span>
                    </div>
                `;
            }
            html += `
                    </div>
                </div>
            `;
        }

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
                    const isFav = this.isFavorite(cat.id, asset.id);
                    html += `
                        <div class="tree-asset ${isSelected ? 'selected' : ''} ${hasSearchResults ? 'match' : ''}"
                             data-asset-id="${escapeHtml(asset.id)}"
                             data-category="${escapeHtml(cat.id)}">
                            <button class="favorite-btn ${isFav ? 'active' : ''}" data-fav-category="${escapeHtml(cat.id)}" data-fav-asset="${escapeHtml(asset.id)}" title="${isFav ? 'Remove from favorites' : 'Add to favorites'}">★</button>
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
            item.addEventListener('click', (e) => {
                // Don't select if clicking favorite button
                if (e.target.classList.contains('favorite-btn')) return;
                this.selectAsset(item.dataset.category, item.dataset.assetId);
            });
        });

        // Add click handlers for favorite buttons
        this.assetTreeEl.querySelectorAll('.favorite-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const category = btn.dataset.favCategory;
                const assetId = btn.dataset.favAsset;
                this.toggleFavorite(category, assetId);
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

    // ═══════════════════════════════════════════════════════════════
    // ASSET FAVORITES
    // ═══════════════════════════════════════════════════════════════

    loadFavorites() {
        const stored = localStorage.getItem('inspector-asset-favorites');
        if (stored) {
            try {
                return new Set(JSON.parse(stored));
            } catch {
                return new Set();
            }
        }
        return new Set();
    }

    saveFavorites() {
        localStorage.setItem('inspector-asset-favorites', JSON.stringify([...this.favorites]));
    }

    getFavoriteKey(category, assetId) {
        return `${category}/${assetId}`;
    }

    isFavorite(category, assetId) {
        return this.favorites.has(this.getFavoriteKey(category, assetId));
    }

    toggleFavorite(category, assetId) {
        const key = this.getFavoriteKey(category, assetId);
        if (this.favorites.has(key)) {
            this.favorites.delete(key);
        } else {
            this.favorites.add(key);
        }
        this.saveFavorites();
        this.renderAssetTree();
    }

    getFavoriteAssets() {
        // Return array of {category, assetId, id} for rendering
        return [...this.favorites].map(key => {
            const [category, ...rest] = key.split('/');
            const assetId = rest.join('/'); // Handle asset IDs with slashes
            return { category, assetId, id: assetId };
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // ENTITY ASSET EXTRACTION
    // ═══════════════════════════════════════════════════════════════

    /**
     * Extract referenced assets from an entity for display in inspector.
     * @param {Object} entity - Entity data with components
     * @returns {Array} Array of {type, path, searchQuery}
     */
    extractEntityAssets(entity) {
        const assets = [];

        // Model asset from modelAssetId
        if (entity.modelAssetId) {
            assets.push({
                type: 'Model',
                path: entity.modelAssetId,
                searchQuery: entity.modelAssetId.split('/').pop() // Search by last part of path
            });
        }

        // Role from NPCEntity component
        const npcEntity = entity.components?.NPCEntity;
        if (npcEntity?.fields?.roleName) {
            const roleName = npcEntity.fields.roleName;
            assets.push({
                type: 'Role',
                path: roleName,
                searchQuery: roleName
            });
        }

        return assets;
    }

    /**
     * Render the assets section in the inspector.
     * @param {Array} assets - Array of extracted assets
     * @returns {string} HTML string
     */
    renderEntityAssetsSection(assets) {
        if (!assets || assets.length === 0) return '';

        let rows = '';
        for (const asset of assets) {
            rows += `
                <div class="asset-link-row" data-search-query="${escapeHtml(asset.searchQuery)}">
                    <span class="asset-type">${escapeHtml(asset.type)}</span>
                    <span class="asset-path clickable">${escapeHtml(asset.path)}</span>
                </div>
            `;
        }

        return `
            <div class="entity-assets-section component-section" data-section-key="ASSETS">
                <div class="component-header">
                    <span class="toggle">[-]</span>
                    <span class="component-name">📦 ASSETS</span>
                </div>
                <div class="component-body">
                    ${rows}
                </div>
            </div>
        `;
    }

    renderAssetDetail() {
        if (!this.assetDetailEl) return;

        // Show/hide refresh button based on whether an asset is selected
        if (this.refreshAssetBtn) {
            this.refreshAssetBtn.classList.toggle('hidden', !this.assetDetail);
        }

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

        // Refresh original JSON button
        if (this.refreshOriginalBtn) {
            this.refreshOriginalBtn.addEventListener('click', () => {
                this.refreshPatchModalAsset();
            });
        }

        // Modified JSON change - fallback for when CodeMirror isn't loaded
        // (CodeMirror 'change' events are set up in initJsonEditorEnhancers)
        if (this.modifiedJson && typeof CodeMirror === 'undefined') {
            this.modifiedJson.addEventListener('input', () => {
                this.updatePatchPreview();
            });
        }

        // Direct JSON change - fallback for when CodeMirror isn't loaded
        if (this.directJson && typeof CodeMirror === 'undefined') {
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

        // Initialize JSON editor enhancers for indent guides, bracket matching, auto-indent
        this.initJsonEditorEnhancers();
    }

    initJsonEditorEnhancers() {
        // CodeMirror configuration for JSON editing
        const cmConfig = {
            mode: { name: 'javascript', json: true },
            theme: 'default',
            lineNumbers: false,
            matchBrackets: true,
            autoCloseBrackets: true,
            foldGutter: true,
            gutters: ['CodeMirror-foldgutter'],
            indentUnit: 2,
            tabSize: 2,
            indentWithTabs: false,
            lineWrapping: false
        };

        // Initialize CodeMirror for modified-json
        if (this.modifiedJson && typeof CodeMirror !== 'undefined') {
            this.modifiedJsonEditor = CodeMirror.fromTextArea(this.modifiedJson, cmConfig);
            this.modifiedJsonEditor.on('change', () => {
                this.updatePatchPreview();
            });
            // Enable indent guides by default
            const modifiedContainer = document.getElementById('modified-json-container');
            if (modifiedContainer) {
                this.setupIndentGuides(this.modifiedJsonEditor, modifiedContainer);
            }
        }

        // Initialize CodeMirror for direct-json
        if (this.directJson && typeof CodeMirror !== 'undefined') {
            this.directJsonEditor = CodeMirror.fromTextArea(this.directJson, cmConfig);
            this.directJsonEditor.on('change', () => {
                this.updatePatchPreviewDirect();
            });
            // Enable indent guides by default
            const directContainer = document.getElementById('direct-json-container');
            if (directContainer) {
                this.setupIndentGuides(this.directJsonEditor, directContainer);
            }
        }

        // Set up editor toggle buttons
        this.setupEditorToggles();

        // Set up resize handle
        this.setupEditorResizeHandle();
    }

    setupIndentGuides(editor, container) {
        // Track if guides are enabled
        container._showIndentGuides = true;

        // Store reference to container on editor for access in renderLine
        editor._guideContainer = container;

        // Add indent guides on line render
        editor.on('renderLine', (cm, line, element) => {
            if (!cm._guideContainer?._showIndentGuides) return;

            const text = line.text;
            if (!text) return;

            // Count leading whitespace
            const match = text.match(/^(\s+)/);
            if (!match) return;

            const whitespace = match[1];
            let spaces = 0;
            for (const char of whitespace) {
                spaces += char === '\t' ? 2 : 1;
            }

            const indentLevels = Math.floor(spaces / 2);
            if (indentLevels === 0) return;

            const charWidth = cm.defaultCharWidth();

            // Add guide elements for each indent level
            for (let level = 1; level <= indentLevels; level++) {
                const guide = document.createElement('span');
                guide.className = 'cm-indent-guide';
                guide.style.left = `${(level - 1) * 2 * charWidth}px`;
                element.insertBefore(guide, element.firstChild);
            }
        });

        // Refresh to apply guides
        editor.refresh();
    }

    toggleIndentGuides(editor, container, show) {
        container._showIndentGuides = show;
        editor.refresh();
    }

    setupEditorToggles() {
        const modifiedContainer = document.getElementById('modified-json-container');
        const directContainer = document.getElementById('direct-json-container');

        // Indent guides toggle for modified editor
        const toggleGuides = document.getElementById('toggle-guides');
        if (toggleGuides && modifiedContainer && this.modifiedJsonEditor) {
            toggleGuides.addEventListener('click', () => {
                const isActive = toggleGuides.classList.toggle('active');
                this.toggleIndentGuides(this.modifiedJsonEditor, modifiedContainer, isActive);
            });
        }

        // Bracket matching toggle for modified editor
        const toggleBrackets = document.getElementById('toggle-brackets');
        if (toggleBrackets && this.modifiedJsonEditor) {
            toggleBrackets.addEventListener('click', () => {
                const isActive = toggleBrackets.classList.toggle('active');
                this.modifiedJsonEditor.setOption('matchBrackets', isActive);
            });
        }

        // Code folding toggle for modified editor
        const toggleFold = document.getElementById('toggle-fold');
        if (toggleFold && this.modifiedJsonEditor) {
            toggleFold.addEventListener('click', () => {
                const isActive = toggleFold.classList.toggle('active');
                this.modifiedJsonEditor.setOption('foldGutter', isActive);
                this.modifiedJsonEditor.setOption('gutters', isActive ? ['CodeMirror-foldgutter'] : []);
            });
        }

        // Indent guides toggle for direct editor
        const toggleGuidesDirect = document.getElementById('toggle-guides-direct');
        if (toggleGuidesDirect && directContainer && this.directJsonEditor) {
            toggleGuidesDirect.addEventListener('click', () => {
                const isActive = toggleGuidesDirect.classList.toggle('active');
                this.toggleIndentGuides(this.directJsonEditor, directContainer, isActive);
            });
        }

        // Bracket matching toggle for direct editor
        const toggleBracketsDirect = document.getElementById('toggle-brackets-direct');
        if (toggleBracketsDirect && this.directJsonEditor) {
            toggleBracketsDirect.addEventListener('click', () => {
                const isActive = toggleBracketsDirect.classList.toggle('active');
                this.directJsonEditor.setOption('matchBrackets', isActive);
            });
        }

        // Code folding toggle for direct editor
        const toggleFoldDirect = document.getElementById('toggle-fold-direct');
        if (toggleFoldDirect && this.directJsonEditor) {
            toggleFoldDirect.addEventListener('click', () => {
                const isActive = toggleFoldDirect.classList.toggle('active');
                this.directJsonEditor.setOption('foldGutter', isActive);
                this.directJsonEditor.setOption('gutters', isActive ? ['CodeMirror-foldgutter'] : []);
            });
        }
    }

    setupEditorResizeHandle() {
        const handle = document.getElementById('editor-resize-handle');
        const patchEditor = document.getElementById('patch-editor-diff');
        if (!handle || !patchEditor) return;

        const originalPane = patchEditor.querySelector('.original-pane');
        const modifiedPane = patchEditor.querySelector('.modified-pane');
        if (!originalPane || !modifiedPane) return;

        let isDragging = false;
        let startX = 0;
        let startOriginalWidth = 0;

        handle.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX;
            startOriginalWidth = originalPane.offsetWidth;
            handle.classList.add('dragging');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;

            const delta = e.clientX - startX;
            const containerWidth = patchEditor.offsetWidth;
            const newOriginalWidth = Math.max(150, Math.min(containerWidth - 200, startOriginalWidth + delta));

            // Set flex-basis for both panes
            originalPane.style.flex = `0 0 ${newOriginalWidth}px`;
            modifiedPane.style.flex = '1 1 auto';

            // Refresh CodeMirror to handle resize
            if (this.modifiedJsonEditor) {
                this.modifiedJsonEditor.refresh();
            }
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                handle.classList.remove('dragging');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // INFO POPOVERS
    // ═══════════════════════════════════════════════════════════════

    setupInfoPopovers() {
        const infoContent = {
            'global': {
                title: 'Entity Inspector Help',
                content: `
                    <p><strong>Welcome to Lait's Entity Inspector!</strong></p>
                    <p>This tool lets you inspect and modify game entities and assets in real-time.</p>
                    <h4>Tabs:</h4>
                    <ul>
                        <li><strong>Entities</strong> - View live game entities (NPCs, items, players)</li>
                        <li><strong>Assets</strong> - Browse and patch game asset definitions</li>
                    </ul>
                    <h4>Tips:</h4>
                    <ul>
                        <li>Click any <em>i</em> button for section-specific help</li>
                        <li>Use the search bar to filter entities or assets</li>
                        <li>Click an entity to inspect its components</li>
                    </ul>
                `
            },
            'entity-list': {
                title: 'Entity List',
                content: `
                    <p>Shows all live entities in the current world.</p>
                    <h4>Features:</h4>
                    <ul>
                        <li><strong>Search</strong> - Filter by name, role, type, or surname</li>
                        <li><strong>Click</strong> - Select entity to view components</li>
                        <li><strong>Teleport</strong> - Click TP button to teleport to entity</li>
                    </ul>
                    <h4>Surname System:</h4>
                    <ul>
                        <li>Give custom names to entities for easy identification</li>
                        <li>Surnames persist across game restarts</li>
                        <li>Visible in-game via entity nameplate</li>
                        <li>Searchable in the filter bar</li>
                    </ul>
                `
            },
            'inspector': {
                title: 'Component Inspector',
                content: `
                    <p>Displays all ECS components attached to the selected entity.</p>
                    <h4>Sub-Tabs:</h4>
                    <ul>
                        <li><strong>Components</strong> - Entity header, asset links, and filtered ECS components</li>
                        <li><strong>Instructions</strong> - Alarms, timers, sensors, instruction tree, and event log</li>
                    </ul>
                    <h4>Interactions:</h4>
                    <ul>
                        <li><strong>Click arrows</strong> - Expand/collapse components</li>
                        <li><strong>Alt+Click</strong> - Expand/collapse all descendants under clicked node</li>
                        <li><strong>Blue "expand"</strong> - Lazy-loaded data, click to fetch (may not always work)</li>
                    </ul>
                    <h4>Controls:</h4>
                    <ul>
                        <li><strong>Font slider (A)</strong> - Scale instructions text size (90%-150%)</li>
                        <li><strong>Fullscreen (⤢)</strong> - Expand inspector to full viewport</li>
                        <li><strong>Event log handle</strong> - Drag the bar between instructions and event log to resize</li>
                    </ul>
                    <h4>Scroll & State:</h4>
                    <ul>
                        <li>Scroll position is preserved per sub-tab across refreshes</li>
                        <li>Event log auto-scrolls to bottom unless you scroll up</li>
                        <li>Expanded/collapsed nodes are remembered across updates</li>
                    </ul>
                `
            },
            'asset-browser': {
                title: 'Asset Browser',
                content: `
                    <p>Browse all game asset definitions organized by category.</p>
                    <h4>Features:</h4>
                    <ul>
                        <li><strong>Search</strong> - Find assets across all categories</li>
                        <li><strong>Click category</strong> - Expand to see assets</li>
                        <li><strong>Click asset</strong> - View full asset definition</li>
                    </ul>
                    <h4>Favorites:</h4>
                    <ul>
                        <li>Click the star icon to favorite an asset</li>
                        <li>Favorites appear at the top of the list</li>
                        <li>Favorites persist across sessions</li>
                    </ul>
                `
            },
            'asset-detail': {
                title: 'Asset Detail',
                content: `
                    <p>Shows the complete JSON definition of the selected asset.</p>
                    <h4>Features:</h4>
                    <ul>
                        <li><strong>Click arrows</strong> - Expand/collapse sections</li>
                        <li><strong>Alt+Click</strong> - Expand/collapse all</li>
                        <li><strong>Create Patch</strong> - Open patch editor for this asset</li>
                    </ul>
                    <h4>Creating Patches:</h4>
                    <p>Use the patch editor to modify assets. Changes take effect after game restart.</p>
                `
            },
            'history': {
                title: 'Patch History',
                content: `
                    <p>Shows all patches created during this session and loaded from disk.</p>
                    <h4>Operations:</h4>
                    <ul>
                        <li><strong>published</strong> - Patch saved to Server/Patch/</li>
                        <li><strong>draft</strong> - Patch saved as draft</li>
                        <li><strong>loaded</strong> - Existing patch loaded from disk</li>
                    </ul>
                    <h4>Actions:</h4>
                    <ul>
                        <li><strong>View</strong> - See patch content in modal</li>
                        <li><strong>Delete</strong> - Remove patch file (requires restart)</li>
                    </ul>
                `
            },
            'alarms': {
                title: 'Entity Alarms',
                content: `
                    <p>Shows timer and alarm states for the selected entity.</p>
                    <h4>Alarm States:</h4>
                    <ul>
                        <li><strong>SET</strong> - Alarm is scheduled</li>
                        <li><strong>PASSED</strong> - Alarm has triggered</li>
                        <li><strong>UNSET</strong> - Alarm is inactive</li>
                    </ul>
                    <h4>Timer States:</h4>
                    <ul>
                        <li><strong>RUNNING</strong> - Timer is active</li>
                        <li><strong>PAUSED</strong> - Timer is paused</li>
                        <li><strong>STOPPED</strong> - Timer is not running</li>
                    </ul>
                `
            },
            'packets': {
                title: 'Packet Log',
                content: `
                    <p>Shows WebSocket messages between GUI and server.</p>
                    <h4>Message Types:</h4>
                    <ul>
                        <li><strong>→ OUT</strong> - Messages sent to server</li>
                        <li><strong>← IN</strong> - Messages received from server</li>
                    </ul>
                    <h4>Controls:</h4>
                    <ul>
                        <li><strong>Clear</strong> - Empty the packet log</li>
                        <li><strong>Toggle</strong> - Pause/resume logging</li>
                    </ul>
                    <p>Useful for debugging packet communication.</p>
                `
            },
            'live': {
                title: 'Live Changes',
                content: `
                    <p>Shows real-time component changes for the selected entity.</p>
                    <h4>Features:</h4>
                    <ul>
                        <li>Displays component updates as they happen</li>
                        <li>Shows old value → new value</li>
                        <li>Auto-scrolls to latest changes</li>
                    </ul>
                    <h4>Use Cases:</h4>
                    <ul>
                        <li>Debug state machine transitions</li>
                        <li>Track health/hunger changes</li>
                        <li>Monitor AI behavior</li>
                    </ul>
                `
            }
        };

        const popover = document.getElementById('info-popover');
        const popoverTitle = popover?.querySelector('.info-popover-title');
        const popoverContent = popover?.querySelector('.info-popover-content');
        const popoverClose = popover?.querySelector('.info-popover-close');

        if (!popover || !popoverTitle || !popoverContent) return;

        // Close button
        popoverClose?.addEventListener('click', () => {
            popover.classList.add('hidden');
        });

        // Close on click outside
        document.addEventListener('click', (e) => {
            if (!popover.classList.contains('hidden') &&
                !popover.contains(e.target) &&
                !e.target.classList.contains('info-btn')) {
                popover.classList.add('hidden');
            }
        });

        // Close on Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !popover.classList.contains('hidden')) {
                popover.classList.add('hidden');
            }
        });

        // Global help button
        const globalBtn = document.getElementById('global-help-btn');
        globalBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showInfoPopover(popover, popoverTitle, popoverContent, infoContent['global'], globalBtn);
        });

        // All other info buttons
        document.querySelectorAll('.info-btn[data-info]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const key = btn.dataset.info;
                if (infoContent[key]) {
                    this.showInfoPopover(popover, popoverTitle, popoverContent, infoContent[key], btn);
                }
            });
        });
    }

    showInfoPopover(popover, titleEl, contentEl, info, triggerBtn) {
        titleEl.textContent = info.title;
        contentEl.innerHTML = info.content;

        // Position popover near button
        const btnRect = triggerBtn.getBoundingClientRect();
        const popoverWidth = 350;
        const popoverHeight = 300;

        // Default to below and left of button
        let left = btnRect.right - popoverWidth;
        let top = btnRect.bottom + 8;

        // Adjust if would go off screen
        if (left < 10) left = 10;
        if (left + popoverWidth > window.innerWidth - 10) {
            left = window.innerWidth - popoverWidth - 10;
        }
        if (top + popoverHeight > window.innerHeight - 10) {
            top = btnRect.top - popoverHeight - 8;
        }

        popover.style.left = `${left}px`;
        popover.style.top = `${top}px`;
        popover.classList.remove('hidden');
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
        // Set modified JSON content - use CodeMirror if available
        if (this.modifiedJsonEditor) {
            this.modifiedJsonEditor.setValue(originalContent);
        } else if (this.modifiedJson) {
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
            // Refresh CodeMirror editors after modal is visible
            // (they need to recalculate dimensions)
            setTimeout(() => {
                if (this.modifiedJsonEditor) {
                    this.modifiedJsonEditor.refresh();
                }
                if (this.directJsonEditor) {
                    this.directJsonEditor.refresh();
                }
            }, 10);
        }
    }

    closePatchModal() {
        if (this.patchModal) {
            this.patchModal.classList.add('hidden');
        }
        // Clear pending modal refresh flag
        this._pendingModalRefresh = null;
    }

    /**
     * Refresh the original JSON in the patch modal while preserving user modifications.
     * Requests fresh asset data from the server.
     */
    refreshPatchModalAsset() {
        if (!this.assetDetail) return;

        // Show loading state
        this.refreshOriginalBtn?.classList.add('loading');

        // Flag this as a modal refresh so handleAssetDetail knows to only update original pane
        this._pendingModalRefresh = {
            category: this.assetDetail.category,
            assetId: this.assetDetail.id
        };

        // Request fresh asset data (reuse existing message)
        this.send('REQUEST_ASSET_DETAIL', {
            category: this.assetDetail.category,
            assetId: this.assetDetail.id
        });
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
            // Use CodeMirror API if available, fallback to textarea
            const modifiedText = this.modifiedJsonEditor
                ? this.modifiedJsonEditor.getValue()
                : (this.modifiedJson?.value || '{}');

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
            // Use CodeMirror API if available, fallback to textarea
            const patchText = this.directJsonEditor
                ? this.directJsonEditor.getValue()
                : (this.directJson?.value || '');
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
                // Server will auto-refresh assets after a short delay and broadcast ASSETS_REFRESHED
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

    handlePatchDeleted(data) {
        if (data.success) {
            this.log(`Patch deleted: ${data.filename}`, 'info');
            // Remove from session history if present
            this.sessionHistory = this.sessionHistory.filter(h => h.filename !== data.filename);
            this.renderHistory();
        } else {
            this.log(`Failed to delete patch: ${data.error}`, 'error');
        }
    }

    handlePatchesList(data) {
        // Populate session history with patches from disk
        if (data.patchesWithContent && data.patchesWithContent.length > 0) {
            // Full patch info available - populate history
            this.sessionHistory = data.patchesWithContent.map(patch => {
                // Extract BaseAssetPath from patch content if possible
                let baseAssetPath = 'unknown';
                try {
                    const parsed = JSON.parse(patch.content);
                    baseAssetPath = parsed.BaseAssetPath || 'unknown';
                } catch (e) {
                    // Ignore parse errors
                }

                return {
                    id: patch.modifiedTime + Math.random(),
                    filename: patch.filename,
                    baseAssetPath: baseAssetPath,
                    timestamp: patch.modifiedTime,
                    operation: 'loaded',  // Indicate these were loaded from disk
                    content: patch.content,
                    isEditable: true  // Our own patches are always editable
                };
            });

            // Sort by timestamp descending (most recent first)
            this.sessionHistory.sort((a, b) => b.timestamp - a.timestamp);

            this.log(`Loaded ${this.sessionHistory.length} patches from disk`, 'info');
            this.renderHistory();
        } else if (data.patches && data.patches.length > 0) {
            // Only filenames available (legacy format)
            console.log('Published patches (filenames only):', data.patches);
        }
    }

    /**
     * Handle ALL_PATCHES_LIST message - patches from all mods with editability info.
     */
    handleAllPatchesList(data) {
        if (!data.patches || data.patches.length === 0) {
            this.sessionHistory = [];
            this.renderHistory();
            return;
        }

        // Convert patches to session history entries
        this.sessionHistory = data.patches.map(patch => {
            // Extract BaseAssetPath from patch content if possible
            let baseAssetPath = 'unknown';
            try {
                const parsed = JSON.parse(patch.content);
                baseAssetPath = parsed.BaseAssetPath || 'unknown';
            } catch (e) {
                // Ignore parse errors
            }

            return {
                id: patch.modifiedTime + Math.random(),
                filename: patch.filename,
                baseAssetPath: baseAssetPath,
                timestamp: patch.modifiedTime,
                operation: patch.isEditable ? 'loaded' : 'external',
                content: patch.content,
                sourceMod: patch.sourceMod,
                isEditable: patch.isEditable
            };
        });

        // Sort by timestamp descending (most recent first)
        this.sessionHistory.sort((a, b) => b.timestamp - a.timestamp);

        const editableCount = this.sessionHistory.filter(p => p.isEditable).length;
        const externalCount = this.sessionHistory.length - editableCount;
        this.log(`Loaded ${editableCount} editable + ${externalCount} readonly patches from all mods`, 'info');
        this.renderHistory();
    }

    requestDeletePatch(filename) {
        this.send('REQUEST_DELETE_PATCH', { filename });
    }

    requestListPatches() {
        // Request patches from all mods (with editability info)
        this.send('REQUEST_LIST_ALL_PATCHES');
    }

    // ═══════════════════════════════════════════════════════════════
    // ENTITY ACTIONS
    // ═══════════════════════════════════════════════════════════════

    requestSetSurname(entityId, surname) {
        this.send('REQUEST_SET_SURNAME', { entityId, surname });
    }

    requestTeleportTo(entityId) {
        this.send('REQUEST_TELEPORT_TO', { entityId });
        this.log(`Teleporting to entity #${entityId}...`, 'info');
    }

    handleSurnameSet(data) {
        if (data.success) {
            this.log(`Surname set for entity #${data.entityId}: "${data.surname}"`, 'info');

            // Update the entity in local cache
            const entity = this.entities.get(data.entityId);
            if (entity) {
                // Ensure LaitInspectorComponent exists
                if (!entity.components) entity.components = {};
                if (!entity.components.LaitInspectorComponent) {
                    entity.components.LaitInspectorComponent = { fields: {} };
                }
                if (!entity.components.LaitInspectorComponent.fields) {
                    entity.components.LaitInspectorComponent.fields = {};
                }
                entity.components.LaitInspectorComponent.fields.surname = data.surname;
            }

            // Update the UI - find and update the specific row
            const row = this.entityListEl?.querySelector(`.entity-row[data-entity-id="${data.entityId}"]`);
            if (row) {
                const surnameText = row.querySelector('.surname-text');
                const editBtn = row.querySelector('.edit-btn');
                if (surnameText) {
                    surnameText.textContent = data.surname || '---';
                    surnameText.title = data.surname || '';
                }
                if (editBtn) {
                    editBtn.dataset.current = data.surname || '';
                }
            }
        } else {
            this.log(`Failed to set surname: ${data.error}`, 'error');
        }
    }

    handleTeleportResult(data) {
        if (data.success) {
            this.log(`Teleported to entity #${data.entityId}`, 'info');
        } else {
            this.log(`Teleport failed: ${data.error}`, 'error');
        }
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
            const isEditable = entry.isEditable !== false;
            const readonlyClass = isEditable ? '' : 'readonly';
            const modBadge = !isEditable && entry.sourceMod
                ? `<span class="source-mod">[${escapeHtml(entry.sourceMod.split(':').pop())}]</span>`
                : '';
            const readonlyBadge = !isEditable
                ? '<span class="readonly-badge">readonly</span>'
                : '';

            return `
                <div class="history-item ${readonlyClass}" data-index="${index}">
                    <div class="filename">${escapeHtml(entry.filename)} ${modBadge}</div>
                    <div class="meta">
                        <span class="time">${time}</span>
                        <span class="operation ${entry.operation}">${entry.operation}</span>
                        ${readonlyBadge}
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

        const isEditable = entry.isEditable !== false;
        const sourceModInfo = entry.sourceMod ? `<span>Source: ${escapeHtml(entry.sourceMod)}</span>` : '';
        const readonlyWarning = !isEditable
            ? '<div class="history-modal-readonly-warning">This patch is from another mod and cannot be edited.</div>'
            : '';

        // Create modal HTML
        const modalHtml = `
            <div class="history-modal-overlay" id="history-modal-overlay">
                <div class="history-modal">
                    <div class="history-modal-header">
                        <span class="history-modal-title">${escapeHtml(entry.filename)}${!isEditable ? ' (readonly)' : ''}</span>
                        <button class="history-modal-close" id="history-modal-close">×</button>
                    </div>
                    <div class="history-modal-meta">
                        <span>Asset: ${escapeHtml(entry.baseAssetPath)}</span>
                        <span>Operation: ${entry.operation}</span>
                        <span>Time: ${new Date(entry.timestamp).toLocaleString()}</span>
                        ${sourceModInfo}
                    </div>
                    ${readonlyWarning}
                    <div class="history-modal-content">
                        <div class="json-editor-container">
                            <div class="indent-guides" id="history-json-guides"></div>
                            <textarea id="history-patch-content" class="json-edit" spellcheck="false" ${!isEditable ? 'readonly' : ''}>${escapeHtml(entry.content || 'No content available')}</textarea>
                            <div class="bracket-highlight-layer" id="history-json-brackets"></div>
                        </div>
                    </div>
                    <div class="history-modal-actions">
                        ${isEditable ? '<button class="btn-danger" id="history-delete-btn">Delete</button>' : ''}
                        <button class="btn-secondary" id="history-copy-btn">Copy</button>
                        ${isEditable ? '<button class="btn-primary" id="history-republish-btn">Republish</button>' : ''}
                    </div>
                    ${isEditable ? `<div class="history-modal-warning">
                        Note: Game may need to be restarted for patch deletion to take effect. Patch revert is planned for a future update.
                    </div>` : ''}
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

        // Initialize JSON editor enhancer for this textarea
        const guidesContainer = document.getElementById('history-json-guides');
        const bracketsContainer = document.getElementById('history-json-brackets');
        if (guidesContainer && bracketsContainer) {
            new JsonEditorEnhancer(contentArea, guidesContainer, bracketsContainer);
        }

        // Close modal function
        const closeModal = () => overlay.remove();

        // Event handlers
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal();
        });
        closeBtn.addEventListener('click', closeModal);

        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => {
                // Use server-side deletion to sync with InspectorPatches folder
                this.requestDeletePatch(entry.filename);
                closeModal();
            });
        }

        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(contentArea.value);
            copyBtn.textContent = 'Copied!';
            setTimeout(() => copyBtn.textContent = 'Copy', 1500);
        });

        if (republishBtn) {
            republishBtn.addEventListener('click', () => {
                const updatedContent = contentArea.value;
                this.requestPublishPatch(entry.filename, updatedContent);
                closeModal();
            });
        }

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

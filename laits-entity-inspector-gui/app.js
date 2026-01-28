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

        // Initialize
        this.setupEventListeners();
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

        // Update inspector if selected
        if (this.selectedEntityId === entity.entityId) {
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

        // Update inspector if showing position
        if (this.selectedEntityId && this.entities.has(this.selectedEntityId)) {
            this.renderInspector();
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
    }

    renderComponent(name, data) {
        const props = data.data || data;

        let propsHtml = '';
        for (const [key, value] of Object.entries(props)) {
            propsHtml += this.renderProperty(key, value);
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

    renderProperty(key, value, depth = 0) {
        const indentStyle = `style="padding-left: ${depth * 16}px"`;
        const safeKey = escapeHtml(key);

        if (value === null || value === undefined) {
            return `<div class="prop-row" ${indentStyle}><span class="prop-key">${safeKey}:</span><span class="prop-value">null</span></div>`;
        }

        if (typeof value === 'object' && !Array.isArray(value)) {
            let html = `<div class="prop-row" ${indentStyle}><span class="prop-key">${safeKey}:</span><span class="prop-value">{</span></div>`;
            for (const [k, v] of Object.entries(value)) {
                html += this.renderProperty(k, v, depth + 1);
            }
            html += `<div class="prop-row" ${indentStyle}><span class="prop-value">}</span></div>`;
            return html;
        }

        if (Array.isArray(value)) {
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

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Don't capture when typing in any input field
            if ((e.target === this.searchInput || e.target === this.componentFilterInput) && e.key !== 'Escape') {
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
                    // Clear entities (local only)
                    this.entities.clear();
                    this.selectedEntityId = null;
                    this.renderEntityList();
                    this.renderInspector();
                    this.updateEntityCount();
                    this.log('Cleared local entity cache', 'info');
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

                case '/':
                    // Focus search
                    e.preventDefault();
                    this.searchInput.focus();
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
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    window.inspector = new EntityInspector();
});

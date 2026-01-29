package com.laits.inspector.transport.websocket;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.hypixel.hytale.logger.HytaleLogger;
import com.laits.inspector.config.InspectorConfig;
import com.laits.inspector.data.EntitySnapshot;
import com.laits.inspector.data.PacketLogEntry;
import com.laits.inspector.data.PositionUpdate;
import com.laits.inspector.data.WorldSnapshot;
import com.laits.inspector.data.asset.*;
import com.laits.inspector.protocol.MessageType;
import com.laits.inspector.protocol.OutgoingMessage;
import com.laits.inspector.transport.DataTransport;
import com.laits.inspector.transport.DataTransportListener;
import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;

import java.net.InetSocketAddress;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * WebSocket transport for real-time entity data streaming.
 * Supports bidirectional communication for interactive inspection.
 */
public class WebSocketTransport implements DataTransport {
    private static final HytaleLogger LOGGER = HytaleLogger.forEnclosingClass();
    private static final Gson GSON = new Gson();

    private final AtomicBoolean running = new AtomicBoolean(false);
    private final Map<WebSocket, ClientSession> sessions = new ConcurrentHashMap<>();

    private WebSocketServer server;
    private DataTransportListener listener;
    private InspectorConfig config;
    private int maxClients;

    @Override
    public void start(InspectorConfig config) throws Exception {
        if (running.get()) {
            LOGGER.atWarning().log("WebSocket transport already running");
            return;
        }

        this.config = config;
        var wsConfig = config.getWebsocket();

        if (!wsConfig.isEnabled()) {
            LOGGER.atInfo().log("WebSocket transport is disabled");
            return;
        }

        this.maxClients = wsConfig.getMaxClients();
        InetSocketAddress address = new InetSocketAddress(wsConfig.getBindAddress(), wsConfig.getPort());

        server = new WebSocketServer(address) {
            @Override
            public void onOpen(WebSocket conn, ClientHandshake handshake) {
                handleOpen(conn, handshake);
            }

            @Override
            public void onClose(WebSocket conn, int code, String reason, boolean remote) {
                handleClose(conn, code, reason, remote);
            }

            @Override
            public void onMessage(WebSocket conn, String message) {
                handleMessage(conn, message);
            }

            @Override
            public void onError(WebSocket conn, Exception ex) {
                handleError(conn, ex);
            }

            @Override
            public void onStart() {
                LOGGER.atInfo().log("WebSocket server started on %s:%d",
                        wsConfig.getBindAddress(), wsConfig.getPort());
                running.set(true);
            }
        };

        server.setConnectionLostTimeout(30);
        server.start();

        LOGGER.atInfo().log("WebSocket transport starting on port %d", wsConfig.getPort());
    }

    @Override
    public void stop() {
        if (!running.compareAndSet(true, false)) {
            return;
        }

        // Close all client sessions
        for (ClientSession session : sessions.values()) {
            try {
                session.close();
            } catch (Exception e) {
                // Ignore close errors
            }
        }
        sessions.clear();

        // Stop the server
        if (server != null) {
            try {
                server.stop(1000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            server = null;
        }

        LOGGER.atInfo().log("WebSocket transport stopped");
    }

    @Override
    public boolean isRunning() {
        return running.get();
    }

    @Override
    public int getClientCount() {
        return sessions.size();
    }

    @Override
    public void setListener(DataTransportListener listener) {
        this.listener = listener;
    }

    // Data sending methods

    @Override
    public void sendWorldSnapshot(WorldSnapshot snapshot) {
        broadcast(OutgoingMessage.init(snapshot).toJson());
    }

    @Override
    public void sendEntitySpawn(EntitySnapshot entity) {
        broadcast(OutgoingMessage.entitySpawn(entity).toJson());
    }

    @Override
    public void sendEntityDespawn(long entityId, String uuid) {
        broadcast(OutgoingMessage.entityDespawn(entityId, uuid).toJson());
    }

    @Override
    public void sendEntityUpdate(EntitySnapshot entity) {
        broadcast(OutgoingMessage.entityUpdate(entity).toJson());
    }

    @Override
    public void sendEntityUpdate(EntitySnapshot entity, List<String> changedComponents) {
        broadcast(OutgoingMessage.entityUpdate(entity, changedComponents).toJson());
    }

    @Override
    public void sendPositionBatch(List<PositionUpdate> positions) {
        if (positions == null || positions.isEmpty()) {
            return;
        }
        broadcast(OutgoingMessage.positionBatch(positions).toJson());
    }

    @Override
    public void sendPacketLog(PacketLogEntry entry) {
        if (entry == null) {
            return;
        }
        broadcast(OutgoingMessage.packetLog(entry).toJson());
    }

    @Override
    public void sendConfigSync(InspectorConfig config) {
        if (config == null) {
            return;
        }
        broadcast(OutgoingMessage.configSync(config).toJson());
    }

    // Internal handlers

    private void handleOpen(WebSocket conn, ClientHandshake handshake) {
        // Check max clients
        if (sessions.size() >= maxClients) {
            LOGGER.atWarning().log("Rejecting connection - max clients reached (%d)", maxClients);
            conn.close(1013, "Max clients reached");
            return;
        }

        ClientSession session = new ClientSession(conn);
        sessions.put(conn, session);

        LOGGER.atInfo().log("Client connected: %s (total: %d)", session.getClientInfo(), sessions.size());

        // Send initial world snapshot if listener is set
        if (listener != null) {
            WorldSnapshot snapshot = listener.onRequestSnapshot(null);
            if (snapshot != null) {
                session.send(OutgoingMessage.init(snapshot).toJson());
                session.setInitialized(true);
            }

            // Send current config
            InspectorConfig currentConfig = listener.getConfig();
            if (currentConfig != null) {
                session.send(OutgoingMessage.configSync(currentConfig).toJson());
            }

            // Send feature info (Hytalor status, etc.)
            FeatureInfo featureInfo = listener.getFeatureInfo();
            if (featureInfo != null) {
                session.send(OutgoingMessage.featureInfo(featureInfo).toJson());
            }
        }
    }

    private void handleClose(WebSocket conn, int code, String reason, boolean remote) {
        ClientSession session = sessions.remove(conn);
        if (session != null) {
            LOGGER.atInfo().log("Client disconnected: %s (code=%d, reason=%s, remote=%s)",
                    session.getClientInfo(), code, reason, remote);
        }
    }

    private void handleMessage(WebSocket conn, String message) {
        ClientSession session = sessions.get(conn);
        if (session == null) {
            return;
        }

        session.updateActivity();

        try {
            LOGGER.atInfo().log("Received message: %s", message.length() > 200 ? message.substring(0, 200) + "..." : message);
            JsonObject json = JsonParser.parseString(message).getAsJsonObject();
            String typeStr = json.has("type") ? json.get("type").getAsString() : null;

            if (typeStr == null) {
                sendError(session, "Missing message type");
                return;
            }

            MessageType type;
            try {
                type = MessageType.valueOf(typeStr);
            } catch (IllegalArgumentException e) {
                sendError(session, "Unknown message type: " + typeStr);
                return;
            }

            handleClientMessage(session, type, json);

        } catch (Exception e) {
            LOGGER.atWarning().log("Error parsing message from %s: %s", session.getClientInfo(), e.getMessage());
            sendError(session, "Invalid message format");
        }
    }

    private void handleClientMessage(ClientSession session, MessageType type, JsonObject json) {
        if (listener == null) {
            sendError(session, "No listener configured");
            return;
        }

        switch (type) {
            case REQUEST_SNAPSHOT -> {
                // Client sends { type, data: { worldId? } }
                String worldId = null;
                if (json.has("data")) {
                    JsonObject data = json.getAsJsonObject("data");
                    if (data.has("worldId")) {
                        worldId = data.get("worldId").getAsString();
                    }
                }
                WorldSnapshot snapshot = listener.onRequestSnapshot(worldId);
                if (snapshot != null) {
                    session.send(OutgoingMessage.init(snapshot).toJson());
                } else {
                    sendError(session, "World not found");
                }
            }
            case REQUEST_ENTITY -> {
                // Client sends { type, data: { entityId } }
                if (!json.has("data")) {
                    sendError(session, "Missing data for entity request");
                    return;
                }
                JsonObject data = json.getAsJsonObject("data");
                if (!data.has("entityId")) {
                    sendError(session, "Missing entityId");
                    return;
                }
                long entityId = data.get("entityId").getAsLong();
                EntitySnapshot entity = listener.onRequestEntity(entityId);
                if (entity != null) {
                    session.send(OutgoingMessage.entityUpdate(entity).toJson());
                } else {
                    sendError(session, "Entity not found: " + entityId);
                }
            }
            case CONFIG_UPDATE -> {
                if (!json.has("data")) {
                    sendError(session, "Missing config data");
                    return;
                }
                JsonObject data = json.getAsJsonObject("data");
                Map<String, Object> updates = new HashMap<>();
                for (var entry : data.entrySet()) {
                    updates.put(entry.getKey(), parseJsonValue(entry.getValue()));
                }
                InspectorConfig updatedConfig = listener.onConfigUpdate(updates);
                if (updatedConfig == null) {
                    sendError(session, "Failed to update config");
                }
                // Config sync is broadcast by InspectorCore
            }
            case REQUEST_EXPAND -> {
                LOGGER.atInfo().log("Received REQUEST_EXPAND: %s", json);
                // Client sends { type, data: { entityId, path } }
                if (!json.has("data")) {
                    LOGGER.atWarning().log("REQUEST_EXPAND missing data field");
                    sendError(session, "Missing data for expand request");
                    return;
                }
                JsonObject data = json.getAsJsonObject("data");
                if (!data.has("entityId") || !data.has("path")) {
                    LOGGER.atWarning().log("REQUEST_EXPAND missing entityId or path in data: %s", data);
                    sendError(session, "Missing entityId or path");
                    return;
                }
                long entityId = data.get("entityId").getAsLong();
                String path = data.get("path").getAsString();
                LOGGER.atInfo().log("Calling onRequestExpand(entityId=%d, path=%s)", entityId, path);
                Object expanded = listener.onRequestExpand(entityId, path);
                LOGGER.atInfo().log("onRequestExpand returned: %s", expanded != null ? "data" : "null");
                if (expanded != null) {
                    String response = OutgoingMessage.expandResponse(entityId, path, expanded).toJson();
                    LOGGER.atInfo().log("Sending expand response: %d chars", response.length());
                    session.send(response);
                } else {
                    sendError(session, "Failed to expand path: " + path);
                }
            }
            case REQUEST_PACKET_EXPAND -> {
                // Client sends { type, data: { packetId, path } }
                if (!json.has("data")) {
                    sendError(session, "Missing data for packet expand request");
                    return;
                }
                JsonObject data = json.getAsJsonObject("data");
                if (!data.has("packetId") || !data.has("path")) {
                    sendError(session, "Missing packetId or path");
                    return;
                }
                long packetId = data.get("packetId").getAsLong();
                String path = data.get("path").getAsString();
                Object expanded = listener.onRequestPacketExpand(packetId, path);
                if (expanded != null) {
                    session.send(OutgoingMessage.packetExpandResponse(packetId, path, expanded).toJson());
                } else {
                    sendError(session, "Failed to expand packet path: " + path);
                }
            }
            case SET_PAUSED -> {
                // Client sends { type, data: { paused: true/false } }
                if (!json.has("data")) {
                    sendError(session, "Missing data for pause request");
                    return;
                }
                JsonObject data = json.getAsJsonObject("data");
                boolean paused = data.has("paused") && data.get("paused").getAsBoolean();
                if (listener instanceof com.laits.inspector.core.InspectorCore core) {
                    core.setPacketLogPaused(paused);
                    LOGGER.atInfo().log("Packet logging %s by client", paused ? "paused" : "resumed");
                }
            }

            // ═══════════════════════════════════════════════════════════════
            // ASSET BROWSER MESSAGES
            // ═══════════════════════════════════════════════════════════════

            case REQUEST_ASSET_CATEGORIES -> {
                var categories = listener.getAssetCategories();
                LOGGER.atInfo().log("Asset categories requested, found %d categories",
                    categories != null ? categories.size() : 0);
                if (categories != null) {
                    session.send(OutgoingMessage.assetCategories(categories).toJson());
                } else {
                    sendError(session, "Failed to get asset categories");
                }
            }

            case REQUEST_ASSETS -> {
                if (!json.has("data")) {
                    sendError(session, "Missing data for assets request");
                    return;
                }
                JsonObject data = json.getAsJsonObject("data");
                String category = data.has("category") ? data.get("category").getAsString() : null;
                String filter = data.has("filter") ? data.get("filter").getAsString() : null;
                var assets = listener.getAssets(category, filter);
                if (assets != null) {
                    session.send(OutgoingMessage.assetList(category, assets).toJson());
                } else {
                    sendError(session, "Failed to get assets for category: " + category);
                }
            }

            case REQUEST_ASSET_DETAIL -> {
                if (!json.has("data")) {
                    sendError(session, "Missing data for asset detail request");
                    return;
                }
                JsonObject data = json.getAsJsonObject("data");
                String category = data.has("category") ? data.get("category").getAsString() : null;
                String assetId = data.has("assetId") ? data.get("assetId").getAsString() : null;
                var detail = listener.getAssetDetail(category, assetId);
                if (detail != null) {
                    session.send(OutgoingMessage.assetDetail(detail).toJson());
                } else {
                    sendError(session, "Asset not found: " + category + "/" + assetId);
                }
            }

            case REQUEST_ASSET_EXPAND -> {
                if (!json.has("data")) {
                    sendError(session, "Missing data for asset expand request");
                    return;
                }
                JsonObject data = json.getAsJsonObject("data");
                String category = data.has("category") ? data.get("category").getAsString() : null;
                String assetId = data.has("assetId") ? data.get("assetId").getAsString() : null;
                String path = data.has("path") ? data.get("path").getAsString() : null;
                Object expanded = listener.onRequestAssetExpand(category, assetId, path);
                if (expanded != null) {
                    session.send(OutgoingMessage.assetExpandResponse(category, assetId, path, expanded).toJson());
                } else {
                    sendError(session, "Failed to expand asset path: " + path);
                }
            }

            case REQUEST_SEARCH_ASSETS -> {
                if (!json.has("data")) {
                    sendError(session, "Missing data for search request");
                    return;
                }
                JsonObject data = json.getAsJsonObject("data");
                String query = data.has("query") ? data.get("query").getAsString() : "";
                var results = listener.searchAssets(query);
                if (results != null) {
                    session.send(OutgoingMessage.searchResults(query, results).toJson());
                } else {
                    sendError(session, "Search failed");
                }
            }

            // ═══════════════════════════════════════════════════════════════
            // HYTALOR PATCHING MESSAGES
            // ═══════════════════════════════════════════════════════════════

            case REQUEST_TEST_WILDCARD -> {
                if (!json.has("data")) {
                    sendError(session, "Missing data for wildcard test");
                    return;
                }
                JsonObject data = json.getAsJsonObject("data");
                String pattern = data.has("pattern") ? data.get("pattern").getAsString() : null;
                var matches = listener.testWildcard(pattern);
                session.send(OutgoingMessage.wildcardMatches(pattern, matches != null ? matches : java.util.Collections.emptyList()).toJson());
            }

            case REQUEST_GENERATE_PATCH -> {
                if (!json.has("data")) {
                    sendError(session, "Missing data for patch generation");
                    return;
                }
                JsonObject data = json.getAsJsonObject("data");
                String basePath = data.has("baseAssetPath") ? data.get("baseAssetPath").getAsString() : null;
                String operation = data.has("operation") ? data.get("operation").getAsString() : "merge";
                @SuppressWarnings("unchecked")
                Map<String, Object> original = data.has("original") ? (Map<String, Object>) parseJsonValue(data.get("original")) : null;
                @SuppressWarnings("unchecked")
                Map<String, Object> modified = data.has("modified") ? (Map<String, Object>) parseJsonValue(data.get("modified")) : null;

                String patchJson = listener.generatePatch(basePath, original, modified, operation);
                if (patchJson != null) {
                    session.send(OutgoingMessage.patchGenerated(patchJson, null).toJson());
                } else {
                    session.send(OutgoingMessage.patchGenerated(null, "No changes detected").toJson());
                }
            }

            case REQUEST_SAVE_DRAFT -> {
                if (!json.has("data")) {
                    sendError(session, "Missing data for draft save");
                    return;
                }
                JsonObject data = json.getAsJsonObject("data");
                String filename = data.has("filename") ? data.get("filename").getAsString() : null;
                String patchJson = data.has("patchJson") ? data.get("patchJson").getAsString() : null;

                String error = listener.saveDraft(filename, patchJson);
                session.send(OutgoingMessage.draftSaved(filename, error == null, error).toJson());
            }

            case REQUEST_PUBLISH_PATCH -> {
                if (!json.has("data")) {
                    sendError(session, "Missing data for patch publish");
                    return;
                }
                JsonObject data = json.getAsJsonObject("data");
                String filename = data.has("filename") ? data.get("filename").getAsString() : null;
                String patchJson = data.has("patchJson") ? data.get("patchJson").getAsString() : null;

                String error = listener.publishPatch(filename, patchJson);
                session.send(OutgoingMessage.patchPublished(filename, error == null, error).toJson());
            }

            case REQUEST_LIST_DRAFTS -> {
                var drafts = listener.listDrafts();
                session.send(OutgoingMessage.draftsList(drafts != null ? drafts : java.util.Collections.emptyList()).toJson());
            }

            default -> sendError(session, "Unsupported message type: " + type);
        }
    }

    /**
     * Parse a JsonElement to a Java object.
     */
    private Object parseJsonValue(com.google.gson.JsonElement element) {
        if (element.isJsonNull()) {
            return null;
        } else if (element.isJsonPrimitive()) {
            var primitive = element.getAsJsonPrimitive();
            if (primitive.isBoolean()) {
                return primitive.getAsBoolean();
            } else if (primitive.isNumber()) {
                return primitive.getAsNumber();
            } else {
                return primitive.getAsString();
            }
        } else if (element.isJsonArray()) {
            var array = element.getAsJsonArray();
            var list = new java.util.ArrayList<Object>();
            for (var item : array) {
                list.add(parseJsonValue(item));
            }
            return list;
        } else if (element.isJsonObject()) {
            var obj = element.getAsJsonObject();
            var map = new HashMap<String, Object>();
            for (var entry : obj.entrySet()) {
                map.put(entry.getKey(), parseJsonValue(entry.getValue()));
            }
            return map;
        }
        return null;
    }

    private void handleError(WebSocket conn, Exception ex) {
        ClientSession session = sessions.get(conn);
        String clientInfo = session != null ? session.getClientInfo() : "unknown";
        LOGGER.atWarning().log("WebSocket error for %s: %s", clientInfo, ex.getMessage());
    }

    private void sendError(ClientSession session, String message) {
        session.send(OutgoingMessage.error(message).toJson());
    }

    private void broadcast(String message) {
        if (!running.get() || sessions.isEmpty()) {
            return;
        }

        for (ClientSession session : sessions.values()) {
            try {
                if (session.isOpen() && session.isInitialized()) {
                    session.send(message);
                }
            } catch (Exception e) {
                // Silent - don't log every failed send
            }
        }
    }
}

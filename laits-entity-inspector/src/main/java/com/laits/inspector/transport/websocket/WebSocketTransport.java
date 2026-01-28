package com.laits.inspector.transport.websocket;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.hypixel.hytale.logger.HytaleLogger;
import com.laits.inspector.config.InspectorConfig;
import com.laits.inspector.data.EntitySnapshot;
import com.laits.inspector.data.PositionUpdate;
import com.laits.inspector.data.WorldSnapshot;
import com.laits.inspector.protocol.MessageType;
import com.laits.inspector.protocol.OutgoingMessage;
import com.laits.inspector.transport.DataTransport;
import com.laits.inspector.transport.DataTransportListener;
import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;

import java.net.InetSocketAddress;
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
    public void sendPositionBatch(List<PositionUpdate> positions) {
        if (positions == null || positions.isEmpty()) {
            return;
        }
        broadcast(OutgoingMessage.positionBatch(positions).toJson());
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
                String worldId = json.has("worldId") ? json.get("worldId").getAsString() : null;
                WorldSnapshot snapshot = listener.onRequestSnapshot(worldId);
                if (snapshot != null) {
                    session.send(OutgoingMessage.init(snapshot).toJson());
                } else {
                    sendError(session, "World not found");
                }
            }
            case REQUEST_ENTITY -> {
                if (!json.has("entityId")) {
                    sendError(session, "Missing entityId");
                    return;
                }
                long entityId = json.get("entityId").getAsLong();
                EntitySnapshot entity = listener.onRequestEntity(entityId);
                if (entity != null) {
                    session.send(OutgoingMessage.entityUpdate(entity).toJson());
                } else {
                    sendError(session, "Entity not found: " + entityId);
                }
            }
            default -> sendError(session, "Unsupported message type: " + type);
        }
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

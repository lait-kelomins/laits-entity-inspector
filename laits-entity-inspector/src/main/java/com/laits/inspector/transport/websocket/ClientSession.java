package com.laits.inspector.transport.websocket;

import org.java_websocket.WebSocket;

import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Tracks state for a connected WebSocket client.
 */
public class ClientSession {
    private final WebSocket connection;
    private final long connectedAt;
    private final AtomicLong lastActivity;
    private final AtomicLong messagesSent;
    private final AtomicBoolean initialized;
    private volatile String clientInfo;

    public ClientSession(WebSocket connection) {
        this.connection = connection;
        this.connectedAt = System.currentTimeMillis();
        this.lastActivity = new AtomicLong(connectedAt);
        this.messagesSent = new AtomicLong(0);
        this.initialized = new AtomicBoolean(false);
        this.clientInfo = connection.getRemoteSocketAddress() != null
                ? connection.getRemoteSocketAddress().toString()
                : "unknown";
    }

    public WebSocket getConnection() {
        return connection;
    }

    public long getConnectedAt() {
        return connectedAt;
    }

    public long getLastActivity() {
        return lastActivity.get();
    }

    public void updateActivity() {
        lastActivity.set(System.currentTimeMillis());
    }

    public long getMessagesSent() {
        return messagesSent.get();
    }

    public void incrementMessagesSent() {
        messagesSent.incrementAndGet();
    }

    public boolean isInitialized() {
        return initialized.get();
    }

    public void setInitialized(boolean value) {
        initialized.set(value);
    }

    public String getClientInfo() {
        return clientInfo;
    }

    public void setClientInfo(String clientInfo) {
        this.clientInfo = clientInfo;
    }

    public boolean isOpen() {
        return connection != null && connection.isOpen();
    }

    public void send(String message) {
        if (isOpen()) {
            connection.send(message);
            incrementMessagesSent();
            updateActivity();
        }
    }

    public void close() {
        if (connection != null && connection.isOpen()) {
            connection.close();
        }
    }

    @Override
    public String toString() {
        return String.format("ClientSession{client=%s, connected=%dms ago, messages=%d, initialized=%s}",
                clientInfo,
                System.currentTimeMillis() - connectedAt,
                messagesSent.get(),
                initialized.get());
    }
}

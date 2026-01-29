package com.laits.inspector.systems;

import com.hypixel.hytale.logger.HytaleLogger;
import com.hypixel.hytale.protocol.Packet;
import com.hypixel.hytale.server.core.io.PacketHandler;
import com.hypixel.hytale.server.core.io.adapter.PacketAdapters;
import com.laits.inspector.config.InspectorConfig;
import com.laits.inspector.core.InspectorCore;
import com.laits.inspector.core.PacketSerializer;
import com.laits.inspector.data.PacketLogEntry;

import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

/**
 * System for logging network packets using the Hytale PacketAdapters API.
 * Captures both inbound and outbound packets for debugging purposes.
 */
public class PacketLoggerSystem {
    private static final HytaleLogger LOGGER = HytaleLogger.forEnclosingClass();

    // Static flag to prevent double registration (PacketAdapters has no unregister)
    private static final AtomicBoolean adaptersRegistered = new AtomicBoolean(false);
    private static volatile PacketLoggerSystem activeInstance = null;

    private final InspectorCore core;
    private final InspectorConfig config;
    private final PacketSerializer serializer;
    private final AtomicBoolean running = new AtomicBoolean(false);
    private final AtomicLong packetCounter = new AtomicLong(0);

    public PacketLoggerSystem(InspectorCore core, InspectorConfig config) {
        this.core = core;
        this.config = config;
        this.serializer = new PacketSerializer();
    }

    /**
     * Start packet logging by registering adapters.
     */
    public void start() {
        if (!config.getPacketLog().isEnabled()) {
            LOGGER.atInfo().log("Packet logging is disabled in config");
            return;
        }

        if (running.getAndSet(true)) {
            LOGGER.atWarning().log("Packet logger already running");
            return;
        }

        // Set this as the active instance (for static adapter callbacks)
        activeInstance = this;

        try {
            // Only register adapters once per JVM (they can't be unregistered)
            if (adaptersRegistered.compareAndSet(false, true)) {
                registerPacketAdapters();
                LOGGER.atInfo().log("Packet logger started (registered adapters)");
            } else {
                LOGGER.atInfo().log("Packet logger started (reusing existing adapters)");
            }
        } catch (Exception e) {
            running.set(false);
            LOGGER.atWarning().log("Failed to start packet logger: %s", e.getMessage());
        }
    }

    /**
     * Stop packet logging.
     * Note: PacketAdapters doesn't provide unregister, so we just stop processing.
     */
    public void stop() {
        if (!running.getAndSet(false)) {
            return;
        }
        // Clear active instance if this is the current one
        if (activeInstance == this) {
            activeInstance = null;
        }
        LOGGER.atInfo().log("Packet logger stopped (logged %d packets)", packetCounter.get());
    }

    /**
     * Check if packet logging is active.
     */
    public boolean isRunning() {
        return running.get();
    }

    /**
     * Get the total number of packets logged.
     */
    public long getPacketCount() {
        return packetCounter.get();
    }

    /**
     * Register packet adapters with the Hytale PacketAdapters API.
     * Uses static activeInstance to support plugin reloads without duplicate
     * registrations.
     */
    private void registerPacketAdapters() {
        // Register outbound packet adapter (server -> client)
        PacketAdapters.registerOutbound((PacketHandler handler, Packet packet) -> {
            PacketLoggerSystem instance = activeInstance;
            if (instance != null && instance.running.get()) {
                instance.processPacket(packet, handler, "outbound");
            }
        });

        // Register inbound packet adapter (client -> server)
        PacketAdapters.registerInbound((PacketHandler handler, Packet packet) -> {
            PacketLoggerSystem instance = activeInstance;
            if (instance != null && instance.running.get()) {
                instance.processPacket(packet, handler, "inbound");
            }
            return false; // Don't block any packets
        });

        LOGGER.atInfo().log("Registered packet adapters for inbound and outbound packets");
    }

    /**
     * Process a captured packet.
     */
    private void processPacket(Packet packet, PacketHandler handler, String direction) {
        if (packet == null) {
            return;
        }

        try {
            String packetName = packet.getClass().getSimpleName();
            String handlerName = handler != null ? handler.getClass().getSimpleName() : "Unknown";

            // Check exclusion
            if (config.getPacketLog().isPacketExcluded(packetName)) {
                return;
            }

            // Serialize packet data
            Map<String, Object> data = serializer.serialize(packet);

            // Get packet ID
            int packetId = packet.getId();

            // Create entry
            PacketLogEntry entry = PacketLogEntry.builder()
                    .direction(direction)
                    .packetName(packetName)
                    .packetId(packetId)
                    .handlerName(handlerName)
                    .data(data)
                    .build();

            // Send to core with original packet for lazy expansion
            core.onPacketLog(entry, packet);
            packetCounter.incrementAndGet();

        } catch (Exception e) {
            // Silent - don't spam logs for packet processing errors
        }
    }
}

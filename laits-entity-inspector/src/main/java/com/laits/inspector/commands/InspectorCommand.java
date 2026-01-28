package com.laits.inspector.commands;

import com.hypixel.hytale.server.core.Message;
import com.hypixel.hytale.server.core.command.system.AbstractCommand;
import com.hypixel.hytale.server.core.command.system.CommandContext;
import com.hypixel.hytale.server.core.command.system.arguments.system.RequiredArg;
import com.hypixel.hytale.server.core.command.system.arguments.types.ArgTypes;
import com.laits.inspector.config.InspectorConfig;
import com.laits.inspector.core.InspectorCore;

import java.util.concurrent.CompletableFuture;

/**
 * Command handler for the /inspector command.
 *
 * Usage:
 *   /inspector                - Show status
 *   /inspector on|off         - Toggle inspector
 *   /inspector rate <ms>      - Set update interval
 *   /inspector pause          - Pause updates
 *   /inspector resume         - Resume updates
 *   /inspector reload         - Reload config
 */
public class InspectorCommand extends AbstractCommand {

    private final InspectorCore core;
    private final InspectorConfig config;

    public InspectorCommand(InspectorCore core, InspectorConfig config) {
        this(core, config, "inspector");
    }

    public InspectorCommand(InspectorCore core, InspectorConfig config, String name) {
        super(name, "Control the entity inspector");
        this.core = core;
        this.config = config;

        // Add subcommands
        addSubCommand(new OnSubCommand());
        addSubCommand(new OffSubCommand());
        addSubCommand(new PauseSubCommand());
        addSubCommand(new ResumeSubCommand());
        addSubCommand(new RateSubCommand());
        addSubCommand(new ReloadSubCommand());
        addSubCommand(new HelpSubCommand());
    }

    @Override
    protected CompletableFuture<Void> execute(CommandContext ctx) {
        showStatus(ctx);
        return CompletableFuture.completedFuture(null);
    }

    private void showStatus(CommandContext ctx) {
        boolean enabled = core.isEnabled();
        boolean paused = core.isPaused();
        int clients = core.getConnectedClients();
        int rateMs = config.getUpdateIntervalMs();
        int rateTicks = config.getUpdateIntervalTicks();

        ctx.sendMessage(Message.raw("=== Entity Inspector Status ===").color("#FF9900"));
        ctx.sendMessage(Message.raw("State: ").color("#AAAAAA")
                .insert(Message.raw(!enabled ? "Disabled" : paused ? "Paused" : "Running")
                        .color(!enabled ? "#FF5555" : paused ? "#FFFF55" : "#55FF55")));
        ctx.sendMessage(Message.raw("Connected clients: ").color("#AAAAAA")
                .insert(Message.raw(String.valueOf(clients)).color("#FFFFFF")));
        ctx.sendMessage(Message.raw("Update rate: ").color("#AAAAAA")
                .insert(Message.raw(rateMs + "ms (" + rateTicks + " ticks)").color("#FFFFFF")));
        ctx.sendMessage(Message.raw("WebSocket port: ").color("#AAAAAA")
                .insert(Message.raw(String.valueOf(config.getWebsocket().getPort())).color("#FFFFFF")));

        ctx.sendMessage(Message.raw("Filters:").color("#AAAAAA"));
        ctx.sendMessage(Message.raw("  NPCs: ").color("#AAAAAA")
                .insert(Message.raw(config.isIncludeNPCs() ? "Yes" : "No")
                        .color(config.isIncludeNPCs() ? "#55FF55" : "#FF5555")));
        ctx.sendMessage(Message.raw("  Players: ").color("#AAAAAA")
                .insert(Message.raw(config.isIncludePlayers() ? "Yes" : "No")
                        .color(config.isIncludePlayers() ? "#55FF55" : "#FF5555")));
        ctx.sendMessage(Message.raw("  Items: ").color("#AAAAAA")
                .insert(Message.raw(config.isIncludeItems() ? "Yes" : "No")
                        .color(config.isIncludeItems() ? "#55FF55" : "#FF5555")));
    }

    // Subcommand: on
    private class OnSubCommand extends AbstractCommand {
        OnSubCommand() {
            super("on", "Enable the inspector");
        }

        @Override
        protected CompletableFuture<Void> execute(CommandContext ctx) {
            core.setEnabled(true);
            ctx.sendMessage(Message.raw("Entity Inspector enabled").color("#55FF55"));
            return CompletableFuture.completedFuture(null);
        }
    }

    // Subcommand: off
    private class OffSubCommand extends AbstractCommand {
        OffSubCommand() {
            super("off", "Disable the inspector");
        }

        @Override
        protected CompletableFuture<Void> execute(CommandContext ctx) {
            core.setEnabled(false);
            ctx.sendMessage(Message.raw("Entity Inspector disabled").color("#FF5555"));
            return CompletableFuture.completedFuture(null);
        }
    }

    // Subcommand: pause
    private class PauseSubCommand extends AbstractCommand {
        PauseSubCommand() {
            super("pause", "Pause updates (keeps connections)");
        }

        @Override
        protected CompletableFuture<Void> execute(CommandContext ctx) {
            core.setPaused(true);
            ctx.sendMessage(Message.raw("Entity Inspector paused (connections kept alive)").color("#FFFF55"));
            return CompletableFuture.completedFuture(null);
        }
    }

    // Subcommand: resume
    private class ResumeSubCommand extends AbstractCommand {
        ResumeSubCommand() {
            super("resume", "Resume updates");
        }

        @Override
        protected CompletableFuture<Void> execute(CommandContext ctx) {
            core.setPaused(false);
            ctx.sendMessage(Message.raw("Entity Inspector resumed").color("#55FF55"));
            return CompletableFuture.completedFuture(null);
        }
    }

    // Subcommand: rate
    private class RateSubCommand extends AbstractCommand {
        private final RequiredArg<Integer> msArg;

        RateSubCommand() {
            super("rate", "Set update interval in milliseconds");
            msArg = withRequiredArg("ms", "Update interval in milliseconds", ArgTypes.INTEGER);
        }

        @Override
        protected CompletableFuture<Void> execute(CommandContext ctx) {
            int ms = msArg.get(ctx);
            if (ms < 33) {
                ctx.sendMessage(Message.raw("Minimum rate is 33ms (1 tick)").color("#FF5555"));
                return CompletableFuture.completedFuture(null);
            }
            core.setUpdateIntervalMs(ms);
            ctx.sendMessage(Message.raw("Update rate set to " + config.getUpdateIntervalMs() + "ms").color("#55FF55"));
            return CompletableFuture.completedFuture(null);
        }
    }

    // Subcommand: reload
    private class ReloadSubCommand extends AbstractCommand {
        ReloadSubCommand() {
            super("reload", "Reload configuration from file");
        }

        @Override
        protected CompletableFuture<Void> execute(CommandContext ctx) {
            config.reload();
            ctx.sendMessage(Message.raw("Configuration reloaded").color("#55FF55"));
            return CompletableFuture.completedFuture(null);
        }
    }

    // Subcommand: help
    private class HelpSubCommand extends AbstractCommand {
        HelpSubCommand() {
            super("help", "Show command help");
        }

        @Override
        protected CompletableFuture<Void> execute(CommandContext ctx) {
            ctx.sendMessage(Message.raw("=== Entity Inspector Commands ===").color("#FF9900"));
            ctx.sendMessage(Message.raw("/inspector").color("#FFFFFF")
                    .insert(Message.raw(" - Show status").color("#AAAAAA")));
            ctx.sendMessage(Message.raw("/inspector on").color("#FFFFFF")
                    .insert(Message.raw("|").color("#555555"))
                    .insert(Message.raw("off").color("#FFFFFF"))
                    .insert(Message.raw(" - Enable/disable inspector").color("#AAAAAA")));
            ctx.sendMessage(Message.raw("/inspector pause").color("#FFFFFF")
                    .insert(Message.raw("|").color("#555555"))
                    .insert(Message.raw("resume").color("#FFFFFF"))
                    .insert(Message.raw(" - Pause/resume updates").color("#AAAAAA")));
            ctx.sendMessage(Message.raw("/inspector rate <ms>").color("#FFFFFF")
                    .insert(Message.raw(" - Set update interval").color("#AAAAAA")));
            ctx.sendMessage(Message.raw("/inspector reload").color("#FFFFFF")
                    .insert(Message.raw(" - Reload configuration").color("#AAAAAA")));
            return CompletableFuture.completedFuture(null);
        }
    }
}

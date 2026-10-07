import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const DATA = GLib.build_filenamev([GLib.get_user_data_dir(), 'handy-gesture-control']);

// Dedicated worker pipe: bounded coordinates drive one selected window; no cursor/key injection.
export class HandControl {
    constructor(extension, status, config = {}) {
        this.ext = extension;
        this.status = status;
        this.config = config;
        this.process = null;
        this.armed = null;
    }
    start() {
        if (this.process) return;
        if (Main.layoutManager.monitors.length < 2) {
            this.status(false, 'Se necesitan dos pantallas'); return;
        }
        const python = `${DATA}/venv/bin/python`, model = `${DATA}/hand_landmarker.task`;
        if (![python, model].every(path => Gio.File.new_for_path(path).query_exists(null))) {
            this.status(false, 'Falta instalar el seguimiento de manos');
            Main.notify('Handy Gesture Control', 'El seguimiento local aún no está instalado.'); return;
        }
        try {
            const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDOUT_PIPE});
            launcher.setenv('OMP_NUM_THREADS', '1', true);
            launcher.setenv('OPENBLAS_NUM_THREADS', '1', true);
            const proc = launcher.spawnv(['/usr/bin/nice', '-n', '10', python, '-u',
                `${this.ext.path}/hand_worker.py`, '--model', model,
                '--camera', String(this.config.camera ?? '/dev/video0'),
                '--fps', String(this.config.fps ?? 24),
                '--pinch-enter', String(this.config.pinchEnter ?? .45),
                '--pinch-release', String(this.config.pinchRelease ?? .72),
                '--open-threshold', String(this.config.openThreshold ?? .85),
                '--arm-seconds', String(this.config.armSeconds ?? .45),
                '--open-seconds', String(this.config.openSeconds ?? .35)]);
            this.process = proc;
            this.lastBeat = GLib.get_monotonic_time();
            this.ready = false;
            this.status(true, 'Preparando cámara…');
            this.input = new Gio.DataInputStream({base_stream: proc.get_stdout_pipe()});
            this._read(proc, this.input);
            proc.wait_async(null, (process, result) => {
                try { process.wait_finish(result); } catch (_) {}
                if (this.process === proc) this.stop('Cámara detenida');
            });
            this.watch = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
                if ((GLib.get_monotonic_time() - this.lastBeat) / 1e6 > (this.ready ? 8 : 60)) {
                    this.stop('La cámara dejó de responder'); return GLib.SOURCE_REMOVE;
                }
                return GLib.SOURCE_CONTINUE;
            });
        } catch (error) { this.stop(error.message); }
    }
    _read(proc, input) {
        input.read_line_async(GLib.PRIORITY_DEFAULT, null, (stream, result) => {
            if (this.process !== proc) return;
            try {
                const [line] = stream.read_line_finish_utf8(result);
                if (line === null) return;
                if (line.length < 4096) {
                    try { this._event(JSON.parse(line)); } catch (error) { console.warn(`Handy Gesture Control: ${error.message}`); }
                }
                if (this.process === proc) this._read(proc, input);
            } catch (_) { if (this.process === proc) this.stop('No se pudo leer el seguimiento'); }
        });
    }
    _allowed() {
        return !Main.sessionMode.isLocked && !Main.overview.visible && !Main.modalCount;
    }
    _event(event) {
        if (!event || !Number.isFinite(event.at) || Math.abs(Date.now() / 1000 - event.at) >
            (['arm', 'drag', 'hover'].includes(event.event) ? .35 : 1)) return;
        if (['heartbeat', 'ready', 'status'].includes(event.event)) {
            this.lastBeat = GLib.get_monotonic_time();
            if (event.event === 'ready') { this.ready = true; this.status(true, 'MANO · LISTA'); }
            return;
        }
        if (event.event === 'error') {
            Main.notify('Handy Gesture Control · cámara', event.detail || 'No se pudo iniciar la cámara');
            this.stop('Cámara no disponible'); return;
        }
        if (event.event === 'stopped') { this.stop(); return; }
        if (!this._allowed()) { this._endDrag(); return; }
        if (event.event === 'hover') {
            if (!this.armed && this._coordinates(event)) {
                const monitor = this._monitorForHand(event.x);
                const label = monitor ? `MANO · ${this._monitorLabel(monitor)} · PINZA PARA AGARRAR` : 'MANO · SIN PANTALLAS';
                if (label !== this._hoverLabel) { this._hoverLabel = label; this.status(true, label); }
            }
            return;
        }
        if (event.event === 'arm') {
            if (!this._coordinates(event) || typeof event.token !== 'string' || !event.token.length || event.token.length > 64) return;
            this._beginDrag(event); return;
        }
        const armed = this.armed;
        if (!armed || event.token !== armed.token) return;
        if (event.event === 'cancel' || event.event === 'release') {
            // Leave the last displayed position exactly as it is. No jump on release.
            this._endDrag(); return;
        }
        if (event.event !== 'drag' || !this._coordinates(event)) return;
        armed.point = {x: event.x, y: event.y};
        armed.lastUpdate = GLib.get_monotonic_time();
    }
    _coordinates(event) {
        return Number.isFinite(event.x) && Number.isFinite(event.y) &&
            event.x >= 0 && event.x <= 1 && event.y >= 0 && event.y <= 1;
    }
    _monitorForHand(x) {
        const monitors = [...Main.layoutManager.monitors].sort((a, b) =>
            (a.x + a.width / 2) - (b.x + b.width / 2) || a.y - b.y);
        if (!monitors.length) return null;
        // Every coordinate has a screen. The old .45–.55 rejection band
        // incorrectly reported "no window" even with a visible primary window.
        if (monitors.length === 2 && x === .5)
            return monitors.find(m => m.index === Main.layoutManager.primaryIndex) ?? monitors[0];
        return monitors[Math.min(monitors.length - 1, Math.floor(x * monitors.length))];
    }
    _monitorLabel(monitor) {
        return monitor.index === Main.layoutManager.primaryIndex ? 'PRINCIPAL' : `PANTALLA ${monitor.index + 1}`;
    }
    _windowForHand(x) {
        const monitor = this._monitorForHand(x);
        this.selectionReason = 'MANO · SIN PANTALLAS';
        if (!monitor) return null;
        const prefix = `MANO · ${this._monitorLabel(monitor)}`;
        const workspace = global.workspace_manager.get_active_workspace();
        const windows = global.get_window_actors().map(actor => actor.meta_window).filter(window =>
            window.get_monitor() === monitor.index && !window.minimized &&
            window.showing_on_its_workspace() && window.located_on_workspace(workspace) &&
            [Meta.WindowType.NORMAL, Meta.WindowType.DIALOG, Meta.WindowType.MODAL_DIALOG].includes(window.get_window_type()));
        const window = global.display.sort_windows_by_stacking(windows).at(-1);
        let reason = null;
        if (!window) reason = 'SIN VENTANAS VISIBLES';
        else if (window.get_window_type() !== Meta.WindowType.NORMAL || window.has_attached_dialogs())
            reason = 'CIERRA EL DIÁLOGO ABIERTO';
        else if (window.is_fullscreen()) reason = 'SAL DE PANTALLA COMPLETA';
        else if (!window.allows_move()) reason = 'LA APLICACIÓN IMPIDE MOVERLA';
        this.selectionReason = reason ? `${prefix} · ${reason}` : null;
        if (reason) return null;
        return {window, monitor, workspace};
    }
    _beginDrag(event) {
        this._endDrag();
        this._hoverLabel = null;
        const selected = this._windowForHand(event.x);
        if (!selected) { this.status(true, this.selectionReason); return; }
        const {window, monitor, workspace} = selected;
        window.raise();
        const wasMaximized = window.is_maximized();
        if (wasMaximized) window.unmaximize();
        const monitors = Main.layoutManager.monitors;
        const left = Math.min(...monitors.map(m => m.x)), top = Math.min(...monitors.map(m => m.y));
        const right = Math.max(...monitors.map(m => m.x + m.width)), bottom = Math.max(...monitors.map(m => m.y + m.height));
        this.armed = {window, token: event.token, workspace, monitor: monitor.index,
            origin: {x: event.x, y: event.y}, point: {x: event.x, y: event.y},
            gainX: (right - left) / .72, gainY: (bottom - top) / .72,
            readyAt: GLib.get_monotonic_time() + (wasMaximized ? 180000 : 0),
            lastUpdate: GLib.get_monotonic_time(), lastTick: GLib.get_monotonic_time(),
            rect: null, x: 0, y: 0};
        this.armed.unmanaged = window.connect('unmanaged', () => this._endDrag());
        this.outline = new St.Widget({reactive: false,
            style: 'border: 2px solid #45d9ff; border-radius: 8px; background-color: rgba(40,190,255,0.035);'});
        Main.layoutManager.addChrome(this.outline, {affectsStruts: false, trackFullscreen: false});
        this._outline(window.get_frame_rect());
        this.status(true, `MANO · ${this._monitorLabel(monitor)} · ARRASTRANDO`);
        this.dragTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
            try { return this._dragFrame(); }
            catch (error) { console.warn(`Handy Gesture Control: ${error.message}`); this._endDrag(); return GLib.SOURCE_REMOVE; }
        });
    }
    _outline(rect) {
        this.outline?.set_position(rect.x - 2, rect.y - 2);
        this.outline?.set_size(rect.width + 4, rect.height + 4);
    }
    _limit(x, y, rect) {
        const workspace = global.workspace_manager.get_active_workspace();
        const areas = Main.layoutManager.monitors.map(m => workspace.get_work_area_for_monitor(m.index));
        const cx = x + rect.width / 2, cy = y + Math.min(40, rect.height / 2);
        const distance = area => Math.hypot(Math.max(area.x - cx, 0, cx - area.x - area.width),
            Math.max(area.y - cy, 0, cy - area.y - area.height));
        areas.sort((a, b) => distance(a) - distance(b));
        const area = areas[0];
        // Keep a usable piece of title bar on a real monitor, including unequal heights.
        return {x: Math.max(area.x - rect.width + 80, Math.min(x, area.x + area.width - 80)),
            y: Math.max(area.y, Math.min(y, area.y + area.height - 48))};
    }
    _dragFrame() {
        const a = this.armed, now = GLib.get_monotonic_time();
        if (!a || !this._allowed() || now - a.lastUpdate > 450000 ||
            global.workspace_manager.get_active_workspace() !== a.workspace || a.window.minimized ||
            a.window.is_fullscreen() || !a.window.showing_on_its_workspace() || !a.window.allows_move()) {
            this._endDrag(); return GLib.SOURCE_REMOVE;
        }
        if (now < a.readyAt) return GLib.SOURCE_CONTINUE;
        if (!a.rect) {
            if (a.window.get_monitor() !== a.monitor) a.window.move_to_monitor(a.monitor);
            a.rect = a.window.get_frame_rect(); a.x = a.rect.x; a.y = a.rect.y;
        }
        const actual = a.window.get_frame_rect();
        const desired = this._limit(a.rect.x + (a.point.x - a.origin.x) * a.gainX,
            a.rect.y + (a.point.y - a.origin.y) * a.gainY, actual);
        const dt = Math.min(.05, Math.max(.001, (now - a.lastTick) / 1e6)); a.lastTick = now;
        const alpha = 1 - Math.exp(-dt / .032);
        a.x += (desired.x - a.x) * alpha; a.y += (desired.y - a.y) * alpha;
        if (Math.abs(a.x - actual.x) >= 2 || Math.abs(a.y - actual.y) >= 2)
            a.window.move_frame(true, Math.round(a.x), Math.round(a.y));
        this._outline(a.window.get_frame_rect());
        return GLib.SOURCE_CONTINUE;
    }
    _endDrag() {
        this._hoverLabel = null;
        const armed = this.armed; this.armed = null;
        if (this.dragTimer) { GLib.source_remove(this.dragTimer); this.dragTimer = null; }
        if (armed?.unmanaged) { try { armed.window.disconnect(armed.unmanaged); } catch (_) {} }
        if (this.outline) { Main.layoutManager.removeChrome(this.outline); this.outline.destroy(); this.outline = null; }
        if (armed) this.status(Boolean(this.process), 'MANO · LISTA');
    }
    stop(detail = 'Cámara desactivada') {
        this._endDrag();
        const proc = this.process; this.process = null;
        if (this.watch) { GLib.source_remove(this.watch); this.watch = null; }
        if (proc) { try { proc.force_exit(); } catch (_) {} }
        this.input = null;
        this.status(false, detail);
    }
}

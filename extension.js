import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {HandControl} from './hands.js';

const DEFAULT_CONFIG = {
    camera: '/dev/video0',
    fps: 24,
    pinchEnter: 0.45,
    pinchRelease: 0.72,
    openThreshold: 0.85,
    armSeconds: 0.45,
    openSeconds: 0.35,
};

function loadConfig() {
    const path = GLib.build_filenamev([
        GLib.get_user_config_dir(), 'handy-gesture-control', 'config.json',
    ]);
    try {
        const [, bytes] = GLib.file_get_contents(path);
        const parsed = JSON.parse(new TextDecoder().decode(bytes));
        return {...DEFAULT_CONFIG, ...parsed};
    } catch (_) {
        return DEFAULT_CONFIG;
    }
}

export default class HandyGestureControlExtension extends Extension {
    enable() {
        this._config = loadConfig();
        this._indicator = new PanelMenu.Button(0.0, 'Handy Gesture Control');
        this._label = new St.Label({text: 'MANO · APAGADA', y_align: Clutter.ActorAlign.CENTER});
        this._indicator.add_child(this._label);

        const toggle = new PopupMenu.PopupMenuItem('Activar / detener cámara');
        toggle.connect('activate', () => {
            if (this._hand?.process)
                this._hand.stop('Cámara desactivada');
            else
                this._hand?.start();
        });
        this._indicator.menu.addMenuItem(toggle);
        this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._statusItem = new PopupMenu.PopupMenuItem('Cámara apagada', {reactive: false});
        this._indicator.menu.addMenuItem(this._statusItem);

        this._hand = new HandControl(this, (active, detail) => this._setStatus(active, detail), this._config);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    _setStatus(active, detail) {
        this._label.text = active ? 'MANO · ACTIVA' : 'MANO · APAGADA';
        this._statusItem.label.text = detail || (active ? 'Seguimiento activo' : 'Cámara apagada');
    }

    disable() {
        this._hand?.stop('Extensión desactivada');
        this._hand = null;
        this._indicator?.destroy();
        this._indicator = null;
        this._label = null;
        this._statusItem = null;
    }
}

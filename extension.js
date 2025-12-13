/* -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*- */
/* exported init */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const TUNED_BUS_NAME = 'com.redhat.tuned';
const TUNED_OBJECT_PATH = '/Tuned';
const TUNED_INTERFACE = 'com.redhat.tuned.control';

const TunedIndicator = GObject.registerClass(
class TunedIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'Tuned Profile Switcher');

        // 创建面板图标和标签容器
        this._box = new St.BoxLayout({style_class: 'panel-status-menu-box'});

        this._icon = new St.Icon({
            icon_name: 'power-profile-balanced-symbolic',
            style_class: 'system-status-icon',
        });
        this._box.add_child(this._icon);

        this._label = new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'tuned-profile-label',
        });
        this._box.add_child(this._label);

        this.add_child(this._box);

        // DBus 代理
        this._proxy = null;
        this._signalId = null;

        // 初始化 DBus 连接
        this._initProxy();
    }

    _initProxy() {
        const cancellable = new Gio.Cancellable();
        Gio.DBusProxy.new_for_bus(
            Gio.BusType.SYSTEM,
            Gio.DBusProxyFlags.NONE,
            null,  // GDBusInterfaceInfo
            TUNED_BUS_NAME,
            TUNED_OBJECT_PATH,
            TUNED_INTERFACE,
            cancellable,
            this._onProxyReady.bind(this)
        );
    }

    _onProxyReady(source, result) {
        try {
            this._proxy = Gio.DBusProxy.new_for_bus_finish(result);

            // 监听 profile_changed 信号
            this._signalId = this._proxy.connect('g-signal', (proxy, senderName, signalName, params) => {
                if (signalName === 'profile_changed') {
                    this._refreshMenu();
                }
            });

            this._refreshMenu();
        } catch (e) {
            console.error(`[Tuned Switcher] Failed to create DBus proxy: ${e.message}`);
            this._label.set_text('Error');
        }
    }

    async _refreshMenu() {
        this.menu.removeAll();

        try {
            // 获取当前 profile
            const activeResult = await this._dbusCall('active_profile');
            const activeProfile = activeResult.get_child_value(0).get_string()[0];
            this._label.set_text(activeProfile);

            // 获取所有 profiles
            const profilesResult = await this._dbusCall('profiles');
            const profilesVariant = profilesResult.get_child_value(0);
            const profiles = [];
            for (let i = 0; i < profilesVariant.n_children(); i++) {
                profiles.push(profilesVariant.get_child_value(i).get_string()[0]);
            }

            // 添加菜单项
            profiles.forEach(profile => {
                const item = new PopupMenu.PopupMenuItem(profile);
                if (profile === activeProfile) {
                    item.setOrnament(PopupMenu.Ornament.DOT);
                }
                item.connect('activate', () => {
                    this._switchProfile(profile);
                });
                this.menu.addMenuItem(item);
            });

            // 添加分隔线和刷新按钮
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            const refreshItem = new PopupMenu.PopupMenuItem('Refresh');
            refreshItem.connect('activate', () => {
                this._refreshMenu();
            });
            this.menu.addMenuItem(refreshItem);

        } catch (e) {
            console.error(`[Tuned Switcher] Failed to refresh menu: ${e.message}`);
            const errorItem = new PopupMenu.PopupMenuItem('Error loading profiles');
            errorItem.setSensitive(false);
            this.menu.addMenuItem(errorItem);
        }
    }

    _dbusCall(method, params = null) {
        return new Promise((resolve, reject) => {
            this._proxy.call(
                method,
                params,
                Gio.DBusCallFlags.NONE,
                -1,
                null,
                (proxy, result) => {
                    try {
                        const reply = proxy.call_finish(result);
                        resolve(reply);
                    } catch (e) {
                        reject(e);
                    }
                }
            );
        });
    }

    async _switchProfile(profileName) {
        try {
            const params = new GLib.Variant('(s)', [profileName]);
            await this._dbusCall('switch_profile', params);
            this._refreshMenu();
        } catch (e) {
            console.error(`[Tuned Switcher] Failed to switch profile: ${e.message}`);
        }
    }

    destroy() {
        if (this._signalId && this._proxy) {
            this._proxy.disconnect(this._signalId);
            this._signalId = null;
        }
        this._proxy = null;
        super.destroy();
    }
});

export default class TunedSwitcherExtension extends Extension {
    enable() {
        this._indicator = new TunedIndicator();
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}

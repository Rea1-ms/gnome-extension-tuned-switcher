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
    _init(settings) {
        super._init(0.0, 'Tuned Profile Switcher');

        this._settings = settings;

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
        this._settingsChangedId = null;

        // 监听设置变化
        this._settingsChangedId = this._settings.connect('changed', () => {
            this._updateLabelVisibility();
            this._refreshMenu();
        });

        this._updateLabelVisibility();

        // 初始化 DBus 连接
        this._initProxy();
    }

    _updateLabelVisibility() {
        const showName = this._settings.get_boolean('show-profile-name');
        this._label.visible = showName;
    }

    _getProfileIcon(profileName) {
        try {
            const iconsJson = this._settings.get_string('profile-icons');
            const icons = JSON.parse(iconsJson);
            return icons[profileName] || 'power-profile-balanced-symbolic';
        } catch (e) {
            return 'power-profile-balanced-symbolic';
        }
    }

    _isEmojiIcon(iconName) {
        // 检测是否为 emoji（非 ASCII 且不是 symbolic 图标名）
        return iconName && !iconName.endsWith('-symbolic') && /[^\x00-\x7F]/.test(iconName);
    }

    _updatePanelIcon(profileName) {
        const iconName = this._getProfileIcon(profileName);

        if (this._isEmojiIcon(iconName)) {
            // 使用 emoji：隐藏图标，在 label 前显示 emoji
            this._icon.visible = false;
            const showName = this._settings.get_boolean('show-profile-name');
            if (showName) {
                this._label.set_text(`${iconName} ${profileName}`);
            } else {
                this._label.set_text(iconName);
                this._label.visible = true;
            }
        } else {
            // 使用系统图标
            this._icon.visible = true;
            this._icon.set_icon_name(iconName);
            this._label.set_text(profileName);
            this._updateLabelVisibility();
        }
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

            // 更新面板图标和标签
            this._updatePanelIcon(activeProfile);

            // 获取所有 profiles
            const profilesResult = await this._dbusCall('profiles');
            const profilesVariant = profilesResult.get_child_value(0);
            const allProfiles = [];
            for (let i = 0; i < profilesVariant.n_children(); i++) {
                allProfiles.push(profilesVariant.get_child_value(i).get_string()[0]);
            }

            // 获取要显示的 profiles
            const visibleProfiles = this._settings.get_strv('visible-profiles');
            const profilesToShow = visibleProfiles.length > 0
                ? allProfiles.filter(p => visibleProfiles.includes(p))
                : allProfiles;

            // 添加菜单项
            profilesToShow.forEach(profile => {
                const iconName = this._getProfileIcon(profile);
                let label = profile;

                // 如果有 emoji 图标，添加到菜单项
                if (this._isEmojiIcon(iconName)) {
                    label = `${iconName}  ${profile}`;
                }

                const item = new PopupMenu.PopupMenuItem(label);

                // 为非 emoji 图标添加图标
                if (!this._isEmojiIcon(iconName)) {
                    const icon = new St.Icon({
                        icon_name: iconName,
                        style_class: 'popup-menu-icon',
                    });
                    item.insert_child_at_index(icon, 1);
                }

                if (profile === activeProfile) {
                    item.setOrnament(PopupMenu.Ornament.DOT);
                }
                item.connect('activate', () => {
                    this._switchProfile(profile);
                });
                this.menu.addMenuItem(item);
            });

            // 添加分隔线和设置按钮
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            const settingsItem = new PopupMenu.PopupMenuItem('Settings');
            settingsItem.connect('activate', () => {
                this._openSettings();
            });
            this.menu.addMenuItem(settingsItem);

        } catch (e) {
            console.error(`[Tuned Switcher] Failed to refresh menu: ${e.message}`);
            const errorItem = new PopupMenu.PopupMenuItem('Error loading profiles');
            errorItem.setSensitive(false);
            this.menu.addMenuItem(errorItem);
        }
    }

    _openSettings() {
        try {
            const extensionManager = Main.extensionManager;
            const extension = extensionManager.lookup('tuned-switcher@ciallo');
            if (extension) {
                extensionManager.openExtensionPrefs(extension.uuid, '', {});
            }
        } catch (e) {
            console.error(`[Tuned Switcher] Failed to open settings: ${e.message}`);
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
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
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
        this._settings = this.getSettings();
        this._indicator = new TunedIndicator(this._settings);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
        this._settings = null;
    }
}

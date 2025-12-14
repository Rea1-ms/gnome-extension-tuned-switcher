/* -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*- */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const TUNED_BUS_NAME = 'com.redhat.tuned';
const TUNED_OBJECT_PATH = '/Tuned';
const TUNED_INTERFACE = 'com.redhat.tuned.control';

// Quick Settings Toggle (显示在控制栏)
const TunedToggle = GObject.registerClass(
class TunedToggle extends QuickSettings.QuickMenuToggle {
    _init(extensionObject) {
        super._init({
            title: 'Tuned',
            iconName: 'power-profile-balanced-symbolic',
            toggleMode: false,
        });

        this._extensionObject = extensionObject;
        this._settings = extensionObject.getSettings();
        this._proxy = null;
        this._signalId = null;
        this._settingsChangedId = null;
        this._activeProfile = '';

        // 设置菜单头部
        this.menu.setHeader('power-profile-balanced-symbolic', 'Tuned Profile');

        // 监听设置变化
        this._settingsChangedId = this._settings.connect('changed', () => {
            this._refreshMenu();
        });

        // 初始化 DBus 连接
        this._initProxy();

        // 点击切换到下一个 profile
        this.connect('clicked', () => {
            this._cycleProfile();
        });
    }

    _initProxy() {
        const cancellable = new Gio.Cancellable();
        Gio.DBusProxy.new_for_bus(
            Gio.BusType.SYSTEM,
            Gio.DBusProxyFlags.NONE,
            null,
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

            this._signalId = this._proxy.connect('g-signal', (proxy, senderName, signalName, params) => {
                if (signalName === 'profile_changed') {
                    this._refreshMenu();
                }
            });

            this._refreshMenu();
        } catch (e) {
            console.error(`[Tuned Switcher] Failed to create DBus proxy: ${e.message}`);
        }
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
        return iconName && !iconName.endsWith('-symbolic') && /[^\x00-\x7F]/.test(iconName);
    }

    async _refreshMenu() {
        // 清除旧菜单项
        this.menu.removeAll();

        try {
            // 获取当前 profile
            const activeResult = await this._dbusCall('active_profile');
            this._activeProfile = activeResult.get_child_value(0).get_string()[0];

            // 更新 toggle 显示
            const iconName = this._getProfileIcon(this._activeProfile);
            if (this._isEmojiIcon(iconName)) {
                this.subtitle = `${iconName} ${this._activeProfile}`;
                this.iconName = 'power-profile-balanced-symbolic';
            } else {
                this.subtitle = this._activeProfile;
                this.iconName = iconName;
            }

            // 更新菜单头部
            this.menu.setHeader(
                this._isEmojiIcon(iconName) ? 'power-profile-balanced-symbolic' : iconName,
                'Tuned Profile',
                this._activeProfile
            );

            // 获取所有 profiles
            const profilesResult = await this._dbusCall('profiles');
            const profilesVariant = profilesResult.get_child_value(0);
            const allProfiles = [];
            for (let i = 0; i < profilesVariant.n_children(); i++) {
                allProfiles.push(profilesVariant.get_child_value(i).get_string()[0]);
            }

            // 获取要显示的 profiles
            const visibleProfiles = this._settings.get_strv('visible-profiles');
            this._profilesToShow = visibleProfiles.length > 0
                ? allProfiles.filter(p => visibleProfiles.includes(p))
                : allProfiles;

            // 添加 profile 菜单项
            this._profilesToShow.forEach(profile => {
                const profIconName = this._getProfileIcon(profile);
                let label = profile;

                if (this._isEmojiIcon(profIconName)) {
                    label = `${profIconName}  ${profile}`;
                }

                const item = new PopupMenu.PopupMenuItem(label);

                if (!this._isEmojiIcon(profIconName)) {
                    const icon = new St.Icon({
                        icon_name: profIconName,
                        style_class: 'popup-menu-icon',
                    });
                    item.insert_child_at_index(icon, 1);
                }

                if (profile === this._activeProfile) {
                    item.setOrnament(PopupMenu.Ornament.CHECK);
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
        }
    }

    async _cycleProfile() {
        if (!this._profilesToShow || this._profilesToShow.length === 0) {
            return;
        }

        const currentIndex = this._profilesToShow.indexOf(this._activeProfile);
        const nextIndex = (currentIndex + 1) % this._profilesToShow.length;
        const nextProfile = this._profilesToShow[nextIndex];

        await this._switchProfile(nextProfile);
    }

    _openSettings() {
        try {
            const extensionManager = Main.extensionManager;
            extensionManager.openExtensionPrefs(this._extensionObject.uuid, '', {});
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

// Quick Settings 指示器
const TunedIndicator = GObject.registerClass(
class TunedIndicator extends QuickSettings.SystemIndicator {
    _init(extensionObject) {
        super._init();

        this._indicator = this._addIndicator();
        this._indicator.iconName = 'power-profile-balanced-symbolic';
        this._indicator.visible = false;  // 默认隐藏指示器图标

        this._toggle = new TunedToggle(extensionObject);
        this.quickSettingsItems.push(this._toggle);
    }

    destroy() {
        this._toggle.destroy();
        super.destroy();
    }
});

export default class TunedSwitcherExtension extends Extension {
    enable() {
        this._indicator = new TunedIndicator(this);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}

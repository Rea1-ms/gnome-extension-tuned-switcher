/**
 * Tuned Profile Switcher - GNOME Shell Extension
 *
 * Switch tuned profiles from Quick Settings panel.
 *
 * SPDX-License-Identifier: GPL-3.0
 * SPDX-FileCopyrightText: 2025 Rea1-ms
 */

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
const DEFAULT_ICON = 'power-profile-balanced-symbolic';

/**
 * Quick Settings menu toggle for tuned profiles
 */
const TunedToggle = GObject.registerClass(
class TunedToggle extends QuickSettings.QuickMenuToggle {
    _init(extensionObject) {
        super._init({
            title: 'Tuned',
            iconName: DEFAULT_ICON,
            toggleMode: false,
        });

        this._extensionObject = extensionObject;
        this._settings = extensionObject.getSettings();
        this._proxy = null;
        this._proxySignalId = null;
        this._settingsSignalId = null;
        this._activeProfile = '';
        this._profilesToShow = [];

        this.menu.setHeader(DEFAULT_ICON, 'Tuned Profile');

        this._settingsSignalId = this._settings.connect('changed', () => {
            this._refreshMenu();
        });

        this._initProxy();

        this.connect('clicked', () => {
            this._cycleProfile();
        });
    }

    _initProxy() {
        Gio.DBusProxy.new_for_bus(
            Gio.BusType.SYSTEM,
            Gio.DBusProxyFlags.NONE,
            null,
            TUNED_BUS_NAME,
            TUNED_OBJECT_PATH,
            TUNED_INTERFACE,
            null,
            this._onProxyReady.bind(this)
        );
    }

    _onProxyReady(source, result) {
        try {
            this._proxy = Gio.DBusProxy.new_for_bus_finish(result);

            this._proxySignalId = this._proxy.connect('g-signal',
                (proxy, senderName, signalName, _params) => {
                    if (signalName === 'profile_changed')
                        this._refreshMenu();
                });

            this._refreshMenu();
        } catch (e) {
            console.error(`[Tuned Switcher] DBus proxy error: ${e.message}`);
        }
    }

    _getProfileIcon(profileName) {
        try {
            const icons = JSON.parse(this._settings.get_string('profile-icons'));
            return icons[profileName] || DEFAULT_ICON;
        } catch {
            return DEFAULT_ICON;
        }
    }

    _isEmojiIcon(iconName) {
        return iconName && !iconName.endsWith('-symbolic') && /[^\x00-\x7F]/.test(iconName);
    }

    async _refreshMenu() {
        this.menu.removeAll();

        if (!this._proxy)
            return;

        try {
            const activeResult = await this._dbusCall('active_profile');
            this._activeProfile = activeResult.get_child_value(0).get_string()[0];

            const iconName = this._getProfileIcon(this._activeProfile);
            const isEmoji = this._isEmojiIcon(iconName);

            this.subtitle = isEmoji ? `${iconName} ${this._activeProfile}` : this._activeProfile;
            this.iconName = isEmoji ? DEFAULT_ICON : iconName;

            this.menu.setHeader(
                isEmoji ? DEFAULT_ICON : iconName,
                'Tuned Profile',
                this._activeProfile
            );

            const profilesResult = await this._dbusCall('profiles');
            const profilesVariant = profilesResult.get_child_value(0);
            const allProfiles = [];
            for (let i = 0; i < profilesVariant.n_children(); i++)
                allProfiles.push(profilesVariant.get_child_value(i).get_string()[0]);

            const visibleProfiles = this._settings.get_strv('visible-profiles');
            this._profilesToShow = visibleProfiles.length > 0
                ? allProfiles.filter(p => visibleProfiles.includes(p))
                : allProfiles;

            for (const profile of this._profilesToShow) {
                const profIcon = this._getProfileIcon(profile);
                const isEmojiProf = this._isEmojiIcon(profIcon);
                const label = isEmojiProf ? `${profIcon}  ${profile}` : profile;

                const item = new PopupMenu.PopupMenuItem(label);

                if (!isEmojiProf) {
                    item.insert_child_at_index(new St.Icon({
                        icon_name: profIcon,
                        style_class: 'popup-menu-icon',
                    }), 1);
                }

                if (profile === this._activeProfile)
                    item.setOrnament(PopupMenu.Ornament.CHECK);

                item.connect('activate', () => this._switchProfile(profile));
                this.menu.addMenuItem(item);
            }

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            const settingsItem = new PopupMenu.PopupMenuItem('Settings');
            settingsItem.connect('activate', () => this._openSettings());
            this.menu.addMenuItem(settingsItem);
        } catch (e) {
            console.error(`[Tuned Switcher] Menu refresh error: ${e.message}`);
        }
    }

    async _cycleProfile() {
        if (this._profilesToShow.length === 0)
            return;

        const currentIndex = this._profilesToShow.indexOf(this._activeProfile);
        const nextIndex = (currentIndex + 1) % this._profilesToShow.length;
        await this._switchProfile(this._profilesToShow[nextIndex]);
    }

    _openSettings() {
        Main.extensionManager.openExtensionPrefs(this._extensionObject.uuid, '', {});
    }

    _dbusCall(method, params = null) {
        return new Promise((resolve, reject) => {
            this._proxy.call(method, params, Gio.DBusCallFlags.NONE, -1, null,
                (proxy, result) => {
                    try {
                        resolve(proxy.call_finish(result));
                    } catch (e) {
                        reject(e);
                    }
                });
        });
    }

    async _switchProfile(profileName) {
        try {
            await this._dbusCall('switch_profile', new GLib.Variant('(s)', [profileName]));
            this._refreshMenu();
        } catch (e) {
            console.error(`[Tuned Switcher] Switch profile error: ${e.message}`);
        }
    }

    destroy() {
        if (this._settingsSignalId) {
            this._settings.disconnect(this._settingsSignalId);
            this._settingsSignalId = null;
        }
        if (this._proxySignalId && this._proxy) {
            this._proxy.disconnect(this._proxySignalId);
            this._proxySignalId = null;
        }
        this._proxy = null;
        super.destroy();
    }
});

/**
 * System indicator for Quick Settings
 */
const TunedIndicator = GObject.registerClass(
class TunedIndicator extends QuickSettings.SystemIndicator {
    _init(extensionObject) {
        super._init();

        this._toggle = new TunedToggle(extensionObject);
        this.quickSettingsItems.push(this._toggle);
    }

    destroy() {
        this._toggle.destroy();
        super.destroy();
    }
});

/**
 * Extension entry point
 */
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

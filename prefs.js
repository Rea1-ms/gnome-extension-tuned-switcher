import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const TUNED_BUS_NAME = 'com.redhat.tuned';
const TUNED_OBJECT_PATH = '/Tuned';
const TUNED_INTERFACE = 'com.redhat.tuned.control';

export default class TunedSwitcherPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // 创建主页面
        const page = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        // === 显示设置组 ===
        const displayGroup = new Adw.PreferencesGroup({
            title: _('Display Settings'),
        });
        page.add(displayGroup);

        // 显示 profile 名称开关
        const showNameRow = new Adw.SwitchRow({
            title: _('Show Profile Name'),
            subtitle: _('Display current profile name in the panel'),
        });
        settings.bind('show-profile-name', showNameRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        displayGroup.add(showNameRow);

        // === Profile 选择组 ===
        const profileGroup = new Adw.PreferencesGroup({
            title: _('Visible Profiles'),
            description: _('Select which profiles to show in the menu'),
        });
        page.add(profileGroup);

        // 获取所有 profiles 并创建选择列表
        this._loadProfiles(profileGroup, settings);

        // === 图标设置组 ===
        const iconGroup = new Adw.PreferencesGroup({
            title: _('Profile Icons'),
            description: _('Customize icons for each profile'),
        });
        page.add(iconGroup);

        this._createIconSettings(iconGroup, settings);
    }

    _loadProfiles(group, settings) {
        // 从 DBus 获取 profiles
        try {
            const connection = Gio.bus_get_sync(Gio.BusType.SYSTEM, null);
            const result = connection.call_sync(
                TUNED_BUS_NAME,
                TUNED_OBJECT_PATH,
                TUNED_INTERFACE,
                'profiles',
                null,
                new GLib.VariantType('(as)'),
                Gio.DBusCallFlags.NONE,
                -1,
                null
            );

            const profiles = result.get_child_value(0).deepUnpack();
            const visibleProfiles = settings.get_strv('visible-profiles');

            profiles.forEach(profile => {
                const row = new Adw.SwitchRow({
                    title: profile,
                });
                row.set_active(visibleProfiles.includes(profile));

                row.connect('notify::active', () => {
                    let current = settings.get_strv('visible-profiles');
                    if (row.get_active()) {
                        if (!current.includes(profile)) {
                            current.push(profile);
                        }
                    } else {
                        current = current.filter(p => p !== profile);
                    }
                    settings.set_strv('visible-profiles', current);
                });

                group.add(row);
            });
        } catch (e) {
            console.error(`[Tuned Switcher] Failed to load profiles: ${e.message}`);
            const errorRow = new Adw.ActionRow({
                title: _('Error loading profiles'),
                subtitle: _('Make sure tuned service is running'),
            });
            group.add(errorRow);
        }
    }

    _createIconSettings(group, settings) {
        const defaultIcons = [
            {profile: 'latency-performance', icon: 'power-profile-performance-symbolic', label: _('Performance')},
            {profile: 'balanced', icon: 'power-profile-balanced-symbolic', label: _('Balanced')},
            {profile: 'powersave', icon: 'power-profile-power-saver-symbolic', label: _('Power Saver')},
        ];

        let profileIcons;
        try {
            profileIcons = JSON.parse(settings.get_string('profile-icons'));
        } catch (e) {
            profileIcons = {};
        }

        defaultIcons.forEach(({profile, icon, label}) => {
            const row = new Adw.EntryRow({
                title: profile,
                text: profileIcons[profile] || icon,
            });

            row.connect('changed', () => {
                try {
                    let icons = JSON.parse(settings.get_string('profile-icons'));
                    icons[profile] = row.get_text();
                    settings.set_string('profile-icons', JSON.stringify(icons));
                } catch (e) {
                    console.error(`[Tuned Switcher] Failed to save icon: ${e.message}`);
                }
            });

            group.add(row);
        });

        // 提示信息
        const hintRow = new Adw.ActionRow({
            title: _('Icon hint'),
            subtitle: _('Use symbolic icon names or emoji (e.g., 🚀, ⚡, 🔋)'),
        });
        group.add(hintRow);
    }
}

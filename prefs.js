import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const TUNED_BUS_NAME = 'com.redhat.tuned';
const TUNED_OBJECT_PATH = '/Tuned';
const TUNED_INTERFACE = 'com.redhat.tuned.control';

// 预设图标选项
const ICON_PRESETS = [
    {id: 'power-profile-performance-symbolic', name: 'Performance'},
    {id: 'power-profile-balanced-symbolic', name: 'Balanced'},
    {id: 'power-profile-power-saver-symbolic', name: 'Power Saver'},
    {id: 'thunderbolt-symbolic', name: 'Thunderbolt'},
    {id: 'battery-full-symbolic', name: 'Battery'},
    {id: 'speedometer-symbolic', name: 'Speedometer'},
    {id: 'cpu-symbolic', name: 'CPU'},
    {id: 'emoji-custom', name: 'Custom (Emoji/Text)'},
];

export default class TunedSwitcherPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        this._settings = this.getSettings();
        this._window = window;
        this._allProfiles = [];
        this._iconRows = new Map();

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
        this._settings.bind('show-profile-name', showNameRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        displayGroup.add(showNameRow);

        // === Profile 选择组 (带图标设置) ===
        this._profileGroup = new Adw.PreferencesGroup({
            title: _('Profiles'),
            description: _('Enable profiles and customize their icons'),
        });
        page.add(this._profileGroup);

        // 加载 profiles
        this._loadProfiles();

        // 监听设置变化以更新 UI
        this._settings.connect('changed::visible-profiles', () => {
            this._updateIconRowsVisibility();
        });
    }

    _loadProfiles() {
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

            this._allProfiles = result.get_child_value(0).deepUnpack();
            const visibleProfiles = this._settings.get_strv('visible-profiles');

            this._allProfiles.forEach(profile => {
                this._createProfileRow(profile, visibleProfiles.includes(profile));
            });
        } catch (e) {
            console.error(`[Tuned Switcher] Failed to load profiles: ${e.message}`);
            const errorRow = new Adw.ActionRow({
                title: _('Error loading profiles'),
                subtitle: _('Make sure tuned service is running'),
            });
            this._profileGroup.add(errorRow);
        }
    }

    _createProfileRow(profile, isVisible) {
        // 创建可展开的行
        const expander = new Adw.ExpanderRow({
            title: profile,
            show_enable_switch: true,
            enable_expansion: isVisible,
        });

        // 启用开关控制 visible-profiles
        expander.connect('notify::enable-expansion', () => {
            let current = this._settings.get_strv('visible-profiles');
            if (expander.enable_expansion) {
                if (!current.includes(profile)) {
                    current.push(profile);
                }
            } else {
                current = current.filter(p => p !== profile);
            }
            this._settings.set_strv('visible-profiles', current);
        });

        // 图标选择下拉
        const iconModel = new Gtk.StringList();
        ICON_PRESETS.forEach(preset => iconModel.append(preset.name));

        const iconRow = new Adw.ComboRow({
            title: _('Icon'),
            subtitle: _('Select preset or choose Custom'),
            model: iconModel,
        });

        // 自定义输入行
        const customRow = new Adw.EntryRow({
            title: _('Custom Icon'),
            text: '',
        });
        customRow.visible = false;

        // 获取当前图标设置
        const currentIcon = this._getProfileIcon(profile);
        const presetIndex = ICON_PRESETS.findIndex(p => p.id === currentIcon);

        if (presetIndex >= 0 && presetIndex < ICON_PRESETS.length - 1) {
            // 预设图标
            iconRow.set_selected(presetIndex);
        } else {
            // 自定义图标
            iconRow.set_selected(ICON_PRESETS.length - 1);  // Custom
            customRow.set_text(currentIcon);
            customRow.visible = true;
        }

        // 图标选择变化
        iconRow.connect('notify::selected', () => {
            const selected = iconRow.get_selected();
            if (selected === ICON_PRESETS.length - 1) {
                // Custom 选项
                customRow.visible = true;
            } else {
                customRow.visible = false;
                this._setProfileIcon(profile, ICON_PRESETS[selected].id);
            }
        });

        // 自定义输入变化
        customRow.connect('changed', () => {
            const text = customRow.get_text().trim();
            if (text) {
                this._setProfileIcon(profile, text);
            }
        });

        expander.add_row(iconRow);
        expander.add_row(customRow);

        this._profileGroup.add(expander);
        this._iconRows.set(profile, {expander, iconRow, customRow});
    }

    _getProfileIcon(profile) {
        try {
            const iconsJson = this._settings.get_string('profile-icons');
            const icons = JSON.parse(iconsJson);
            return icons[profile] || 'power-profile-balanced-symbolic';
        } catch (e) {
            return 'power-profile-balanced-symbolic';
        }
    }

    _setProfileIcon(profile, iconName) {
        try {
            let icons = {};
            try {
                icons = JSON.parse(this._settings.get_string('profile-icons'));
            } catch (e) {
                // ignore parse error
            }
            icons[profile] = iconName;
            this._settings.set_string('profile-icons', JSON.stringify(icons));
        } catch (e) {
            console.error(`[Tuned Switcher] Failed to save icon: ${e.message}`);
        }
    }

    _updateIconRowsVisibility() {
        const visibleProfiles = this._settings.get_strv('visible-profiles');
        this._iconRows.forEach((rows, profile) => {
            rows.expander.enable_expansion = visibleProfiles.includes(profile);
        });
    }
}

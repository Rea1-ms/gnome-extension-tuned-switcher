/**
 * Tuned Profile Switcher - Preferences
 *
 * SPDX-License-Identifier: GPL-3.0
 * SPDX-FileCopyrightText: 2025 Rea1-ms
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const TUNED_BUS_NAME = 'com.redhat.tuned';
const TUNED_OBJECT_PATH = '/Tuned';
const TUNED_INTERFACE = 'com.redhat.tuned.control';

const ICON_PRESETS = [
    {id: 'power-profile-performance-symbolic', name: 'Performance'},
    {id: 'power-profile-balanced-symbolic', name: 'Balanced'},
    {id: 'power-profile-power-saver-symbolic', name: 'Power Saver'},
    {id: 'thunderbolt-symbolic', name: 'Thunderbolt'},
    {id: 'battery-full-symbolic', name: 'Battery'},
    {id: 'speedometer-symbolic', name: 'Speedometer'},
    {id: 'emoji-custom', name: 'Custom (Emoji/Text)'},
];

export default class TunedSwitcherPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        this._settings = this.getSettings();
        this._iconRows = new Map();

        const page = new Adw.PreferencesPage({
            title: _('Profiles'),
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        this._profileGroup = new Adw.PreferencesGroup({
            title: _('Profiles'),
            description: _('Enable profiles and customize their icons'),
        });
        page.add(this._profileGroup);

        this._loadProfiles();
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

            const profiles = result.get_child_value(0).deepUnpack();
            const visibleProfiles = this._settings.get_strv('visible-profiles');

            for (const profile of profiles)
                this._createProfileRow(profile, visibleProfiles.includes(profile));
        } catch (e) {
            console.error(`[Tuned Switcher] Load profiles error: ${e.message}`);
            this._profileGroup.add(new Adw.ActionRow({
                title: _('Error loading profiles'),
                subtitle: _('Make sure tuned service is running'),
            }));
        }
    }

    _createProfileRow(profile, isVisible) {
        const expander = new Adw.ExpanderRow({
            title: profile,
            show_enable_switch: true,
            enable_expansion: isVisible,
        });

        expander.connect('notify::enable-expansion', () => {
            let current = this._settings.get_strv('visible-profiles');
            if (expander.enable_expansion) {
                if (!current.includes(profile))
                    current.push(profile);
            } else {
                current = current.filter(p => p !== profile);
            }
            this._settings.set_strv('visible-profiles', current);
        });

        const iconModel = new Gtk.StringList();
        for (const preset of ICON_PRESETS)
            iconModel.append(preset.name);

        const iconRow = new Adw.ComboRow({
            title: _('Icon'),
            subtitle: _('Select preset or choose Custom'),
            model: iconModel,
        });

        const customRow = new Adw.EntryRow({
            title: _('Custom Icon'),
        });
        customRow.visible = false;

        const currentIcon = this._getProfileIcon(profile);
        const presetIndex = ICON_PRESETS.findIndex(p => p.id === currentIcon);

        if (presetIndex >= 0 && presetIndex < ICON_PRESETS.length - 1) {
            iconRow.set_selected(presetIndex);
        } else {
            iconRow.set_selected(ICON_PRESETS.length - 1);
            customRow.set_text(currentIcon);
            customRow.visible = true;
        }

        iconRow.connect('notify::selected', () => {
            const selected = iconRow.get_selected();
            if (selected === ICON_PRESETS.length - 1) {
                customRow.visible = true;
            } else {
                customRow.visible = false;
                this._setProfileIcon(profile, ICON_PRESETS[selected].id);
            }
        });

        customRow.connect('changed', () => {
            const text = customRow.get_text().trim();
            if (text)
                this._setProfileIcon(profile, text);
        });

        expander.add_row(iconRow);
        expander.add_row(customRow);
        this._profileGroup.add(expander);
        this._iconRows.set(profile, {expander, iconRow, customRow});
    }

    _getProfileIcon(profile) {
        try {
            const icons = JSON.parse(this._settings.get_string('profile-icons'));
            return icons[profile] || 'power-profile-balanced-symbolic';
        } catch {
            return 'power-profile-balanced-symbolic';
        }
    }

    _setProfileIcon(profile, iconName) {
        try {
            let icons = {};
            try {
                icons = JSON.parse(this._settings.get_string('profile-icons'));
            } catch {
                // Use empty object on parse error
            }
            icons[profile] = iconName;
            this._settings.set_string('profile-icons', JSON.stringify(icons));
        } catch (e) {
            console.error(`[Tuned Switcher] Save icon error: ${e.message}`);
        }
    }
}

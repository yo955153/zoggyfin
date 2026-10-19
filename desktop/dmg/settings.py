# dmgbuild settings for the Zoggyfin DMG (desktop/scripts/release.sh runs dmgbuild with this file).
#
#   dmgbuild -s desktop/dmg/settings.py -D app=<path to Zoggyfin.app> -D icon=<icon.icns> \
#     -D background=desktop/dmg/background.png Zoggyfin <out.dmg>
#
# dmgbuild writes the Finder window layout (.DS_Store) and the background alias itself, without
# Finder or AppleScript, so the layout is the same on a headless build. The values must match
# desktop/scripts/dmg-background.py (window 600x380, icon centres at y 170).
import os.path

application = defines["app"]  # noqa: F821 (dmgbuild provides `defines`)
appname = os.path.basename(application)

format = "UDZO"
filesystem = "HFS+"
size = None  # dmgbuild measures the contents

files = [application]
symlinks = {"Applications": "/Applications"}
hide_extensions = [appname]
icon = defines.get("icon") or None  # noqa: F821 (the volume icon)

background = defines["background"]  # noqa: F821 (background@2x.png next to it is picked up too)

window_rect = ((200, 160), (600, 380))
default_view = "icon-view"
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
show_icon_preview = False
include_icon_view_settings = True
include_list_view_settings = False

arrange_by = None
icon_size = 128
text_size = 13
label_pos = "bottom"
icon_locations = {
    appname: (150, 170),
    "Applications": (450, 170),
}
